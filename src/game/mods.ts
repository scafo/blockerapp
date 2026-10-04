// Modificatori di una campagna: civiltà (bonus + edificio unico), ricerche del Laboratorio, Sala Radar.
// Le chiavi che finiscono in "Mult" si moltiplicano, le altre si sommano.
export interface Mods {
  neutralCostMult: number; // costo per prendere caselle neutrali (giocatore)
  ownedDefenseMult: number; // difesa delle caselle del giocatore
  growthMult: number; // crescita truppe del giocatore
  unitCostMult: number;
  unitHpMult: number;
  unitAttackMult: number; // danni delle unità del giocatore
  attackCostMult: number; // truppe per prendere province (neutrali e nemiche)
  prodMult: number; // produzione delle province
  bunkerMult: number; // forza dei tuoi bunker
  lootMult: number; // bottino raccolto sulla mappa
  flowSpeedMult: number; // velocità dell'avanzata
  capitalTroopsMult: number; // truppe dalle capitali conquistate
  expeditionTimeMult: number; // accampamento: durata delle spedizioni
  fogBonus: number; // caselle di vista in più
  startTroops: number;
  settlementGrowth: number; // caselle di crescita in più per insediamento
  settlementDefense: number; // difesa in più degli insediamenti
  settlementLoot: number; // risorse per tick per insediamento (metallo e benzina)
}

export const BASE_MODS: Mods = {
  neutralCostMult: 1, ownedDefenseMult: 1, growthMult: 1, unitCostMult: 1, unitHpMult: 1, unitAttackMult: 1, attackCostMult: 1, prodMult: 1, bunkerMult: 1, lootMult: 1, flowSpeedMult: 1,
  capitalTroopsMult: 1, expeditionTimeMult: 1,
  fogBonus: 0, startTroops: 0, settlementGrowth: 0, settlementDefense: 0, settlementLoot: 0,
};

export function combine(...parts: Partial<Mods>[]): Mods {
  const m: Mods = { ...BASE_MODS };
  for (const p of parts) {
    for (const [k, v] of Object.entries(p) as [keyof Mods, number][]) {
      if (typeof v !== 'number') continue;
      m[k] = k.endsWith('Mult') ? m[k] * v : m[k] + v;
    }
  }
  return m;
}
