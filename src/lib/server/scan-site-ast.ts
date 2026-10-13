// Проверка сайта по синтаксическому дереву (тем же @babel/parser, что разбирает JS в REA). Регулярки смотрят
// в окно ±400 символов и путают ABI-строки библиотек с вызовами; дерево отвечает на точный вопрос: есть ли
// вызов approve / setApprovalForAll / перевода Solana, у которого получатель — зашитый в код чужой адрес.
// Код сайта не исполняется: только разбор текста, который уже скачан через безопасный загрузчик.
import { parse } from "@babel/parser";

export interface AstFinding {
  key: "evm-approval" | "sol-drain";
  note: string;
  evidence: string;
}

type Node = { type: string; start?: number | null; end?: number | null; [k: string]: unknown };

const MAX_PARSE = 1_500_000; // больше — не разбираем, остаются регулярки
const ADDR = /^0x[a-fA-F0-9]{40}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_HEX = /^(0x)?f{64}$/i;
const APPROVE = new Set(["approve", "increaseAllowance"]);
const SOL_SEND = new Set(["createTransferInstruction", "createTransferCheckedInstruction", "createApproveInstruction", "createApproveCheckedInstruction", "createSetAuthorityInstruction", "transfer"]);
// Известные адреса, которые законно зашиты в dapp-ы (Permit2, Seaport, роутеры): их передаёт scan-site.ts.
let known: Set<string> = new Set();

// Обход дерева без рекурсии: минифицированные бандлы бывают очень глубокими.
function walk(root: Node, visit: (n: Node, parent: Node | null) => void) {
  const stack: [Node, Node | null][] = [[root, null]];
  let steps = 0;
  while (stack.length) {
    const [n, p] = stack.pop()!;
    if (++steps > 3_000_000) return; // предохранитель на гигантские бандлы
    visit(n, p);
    for (const k in n) {
      if (k === "loc" || k === "start" || k === "end" || k === "extra" || k === "leadingComments" || k === "trailingComments") continue;
      const v = n[k];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c === "object" && typeof (c as Node).type === "string") stack.push([c as Node, n]);
      } else if (v && typeof v === "object" && typeof (v as Node).type === "string") stack.push([v as Node, n]);
    }
  }
}

const name = (n: unknown): string | undefined => {
  const x = n as Node | undefined;
  if (!x) return;
  if (x.type === "Identifier") return x.name as string;
  if (x.type === "MemberExpression" || x.type === "OptionalMemberExpression") {
    const pr = x.property as Node;
    if (pr.type === "Identifier") return pr.name as string;
    if (pr.type === "StringLiteral") return pr.value as string;
  }
};

export function astScan(code: string, knownAddrs: Set<string>): { ok: boolean; findings: AstFinding[] } {
  if (code.length > MAX_PARSE) return { ok: false, findings: [] };
  known = knownAddrs;
  let ast: Node;
  try {
    ast = parse(code, { sourceType: "unambiguous", errorRecovery: true, allowReturnOutsideFunction: true, plugins: ["jsx"] }) as unknown as Node;
  } catch {
    return { ok: false, findings: [] };
  }

  // Константы файла: const SPENDER = "0x…" / const to = new PublicKey("…"). Имена в бандле переиспользуются,
  // поэтому храним только те, что встретились ровно с одним литералом.
  const consts = new Map<string, string | null>();
  const lit = (n: unknown): string | undefined => {
    const x = n as Node | undefined;
    if (!x) return;
    if (x.type === "StringLiteral") return x.value as string;
    if (x.type === "TemplateLiteral" && (x.expressions as unknown[]).length === 0) return ((x.quasis as Node[])[0]?.value as { cooked?: string })?.cooked;
    if (x.type === "NewExpression" && name(x.callee) === "PublicKey") return lit((x.arguments as Node[])[0]);
    if (x.type === "Identifier") return consts.get(x.name as string) ?? undefined;
  };
  walk(ast, (n) => {
    if (n.type !== "VariableDeclarator") return;
    const id = n.id as Node;
    if (id?.type !== "Identifier") return;
    const v = n.init as Node | undefined;
    const s = v && (v.type === "StringLiteral" || v.type === "NewExpression" || v.type === "TemplateLiteral") ? lit(v) : undefined;
    if (!s || !(ADDR.test(s) || B58.test(s))) return;
    const k = id.name as string;
    consts.set(k, consts.has(k) && consts.get(k) !== s ? null : s);
  });

  const stranger = (n: unknown) => {
    const s = lit(n);
    if (!s) return;
    if (ADDR.test(s) && !known.has(s.toLowerCase())) return s;
    if (B58.test(s)) return s;
  };
  const isMax = (n: unknown): boolean => {
    const x = n as Node | undefined;
    if (!x) return false;
    const s = lit(x);
    if (s && MAX_HEX.test(s)) return true;
    if (x.type === "BigIntLiteral" || x.type === "NumericLiteral") return MAX_HEX.test(String((x.extra as { raw?: string })?.raw ?? "").replace(/n$/, ""));
    const nm = name(x);
    if (nm && /^max_?uint_?256$/i.test(nm)) return true;
    // 2n ** 256n - 1n и подобные выражения
    if (x.type === "BinaryExpression") return /2n?\s*\*\*\s*256/.test(code.slice(x.start ?? 0, x.end ?? 0));
    return false;
  };
  const ev = (n: Node) => code.slice(n.start ?? 0, Math.min(n.end ?? 0, (n.start ?? 0) + 120)).replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "").slice(0, 80);

  const out = new Map<string, AstFinding>();
  walk(ast, (n) => {
    if (out.size === 2) return;
    // contract.approve(0xSPENDER, MaxUint256) / increaseAllowance
    if ((n.type === "CallExpression" || n.type === "OptionalCallExpression") && !out.has("evm-approval")) {
      const fn = name(n.callee);
      const args = n.arguments as Node[];
      if (fn && APPROVE.has(fn) && args.length >= 2 && isMax(args[1])) {
        const to = stranger(args[0]);
        if (to && ADDR.test(to)) out.set("evm-approval", { key: "evm-approval", note: `Code calls ${fn}(${to.slice(0, 10)}..., unlimited): a hard-coded wallet gets unlimited access to your tokens.`, evidence: ev(n) });
      }
      if (fn === "setApprovalForAll" && args.length >= 2 && (args[1] as Node).type === "BooleanLiteral" && (args[1] as Node).value === true) {
        const to = stranger(args[0]);
        if (to && ADDR.test(to)) out.set("evm-approval", { key: "evm-approval", note: `Code calls setApprovalForAll(${to.slice(0, 10)}..., true): a hard-coded operator gets every NFT in the wallet.`, evidence: ev(n) });
      }
    }
    // writeContract({ functionName: "approve", args: [0xSPENDER, max] }) — стиль wagmi/viem
    if (n.type === "ObjectExpression" && !out.has("evm-approval")) {
      const props = (n.properties as Node[]).filter((p) => p.type === "ObjectProperty");
      const fnProp = props.find((p) => name(p.key) === "functionName" || lit(p.key) === "functionName");
      const fn = fnProp && lit(fnProp.value);
      const argsProp = props.find((p) => name(p.key) === "args");
      const arr = argsProp?.value as Node | undefined;
      if (fn && arr?.type === "ArrayExpression") {
        const el = arr.elements as Node[];
        const to = stranger(el[0]);
        if (to && ADDR.test(to) && ((APPROVE.has(fn) && isMax(el[1])) || (fn === "setApprovalForAll" && (el[1] as Node)?.value === true)))
          out.set("evm-approval", { key: "evm-approval", note: `Code sends ${fn} with a hard-coded spender ${to.slice(0, 10)}...: the classic drainer move.`, evidence: ev(n) });
      }
    }
    // Готовые calldata: "0x095ea7b3" + адрес получателя + сумма — апрув, собранный руками.
    if (n.type === "StringLiteral" && !out.has("evm-approval")) {
      const s = n.value as string;
      const m = /^0x095ea7b30{24}([a-f0-9]{40})(f{64})$/i.exec(s);
      if (m && !known.has(`0x${m[1].toLowerCase()}`)) out.set("evm-approval", { key: "evm-approval", note: `Code carries raw approve calldata for 0x${m[1].slice(0, 8)}... with an unlimited amount.`, evidence: s.slice(0, 80) });
    }
    // Solana: перевод/апрув/смена владельца, где получатель — зашитый адрес.
    if ((n.type === "CallExpression" || n.type === "OptionalCallExpression") && !out.has("sol-drain")) {
      const fn = name(n.callee);
      if (!fn || !SOL_SEND.has(fn)) return;
      const args = n.arguments as Node[];
      // SystemProgram.transfer({ fromPubkey, toPubkey: new PublicKey("…"), lamports })
      if (fn === "transfer") {
        if (name((n.callee as Node).object) !== "SystemProgram") return;
        const o = args[0];
        if (o?.type !== "ObjectExpression") return;
        const to = (o.properties as Node[]).find((p) => name(p.key) === "toPubkey");
        const addr = to && stranger(to.value);
        if (addr && B58.test(addr)) out.set("sol-drain", { key: "sol-drain", note: `Code sends SOL to a hard-coded wallet ${addr.slice(0, 6)}...`, evidence: ev(n) });
        return;
      }
      // createTransfer(Checked)Instruction(source, [mint,] destination, owner, …): получатель — 2-й или 3-й аргумент
      const idx = fn === "createTransferCheckedInstruction" || fn === "createApproveCheckedInstruction" ? [2] : fn === "createSetAuthorityInstruction" ? [3] : [1];
      for (const i of idx) {
        const addr = stranger(args[i]);
        if (addr && B58.test(addr)) {
          out.set("sol-drain", { key: "sol-drain", note: `Code builds ${fn} to a hard-coded address ${addr.slice(0, 6)}...`, evidence: ev(n) });
          break;
        }
      }
    }
  });
  return { ok: true, findings: [...out.values()] };
}
