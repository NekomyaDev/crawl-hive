// Ответы живой торговли не кэшируются нигде: там балансы, позиции и (в /export) секретный ключ.
export function noStore(res: Response) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Pragma", "no-cache");
  return res;
}
