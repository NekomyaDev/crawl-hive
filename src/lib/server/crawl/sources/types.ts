import type { LiveSignalInput } from "../../store";

export interface SourceResult {
  items: number; // сколько единиц данных просмотрено (посты, сообщения, пары, страницы)
  signals: LiveSignalInput[];
  cursor: Record<string, string>;
  filtered?: number; // токены, отсеянные проверкой безопасности
}
