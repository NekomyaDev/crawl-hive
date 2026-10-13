// Для страницы подтверждения: имя приложения, которое просит доступ, и проверка адреса возврата.
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { clientFor } from "@/lib/server/oauth";

export async function GET(req: NextRequest) {
  return handle(() => {
    const redirect = req.nextUrl.searchParams.get("redirect_uri") ?? "";
    const c = clientFor(req.nextUrl.searchParams.get("client_id") ?? "", redirect);
    // Показываем адрес, куда реально уйдёт код, а не первый из списка клиента: иначе можно было бы
    // зарегистрировать «Claude» с чужим адресом вторым и обмануть владельца.
    const u = new URL(redirect);
    return { name: c.client_name, redirectHost: u.host || `${u.protocol}//`, redirectUri: redirect };
  });
}
