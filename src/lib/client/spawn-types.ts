import type { Chain, Narrative, Source, Tier } from "../types";

export interface SpawnPayload {
  name: string;
  source: Source;
  chain: Chain;
  narratives: Narrative[];
  targets: string[];
  frequencyMin: number;
  tier: Tier;
}
