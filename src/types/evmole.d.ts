// evmole отдаёт типы, но его package.json "exports" их не указывает — описываем то, чем пользуемся.
declare module "evmole" {
  export interface ContractFunction { selector: string; bytecodeOffset: number; dispatch: "abi" | "fallback"; arguments?: string; stateMutability?: string }
  export interface StorageRecord { slot: string; offset: number; type: string; reads: string[]; writes: string[] }
  export interface Contract { functions?: ContractFunction[]; storage?: StorageRecord[] }
  export function contractInfo(
    code: string,
    args: { selectors?: boolean; arguments?: boolean; stateMutability?: boolean; storage?: boolean },
  ): Contract;
}
