// Le 3 risorse della run e il loro zaino.
import type { Resource } from '../config/balance';

export const RESOURCES: Resource[] = ['metallo', 'benzina', 'cibo'];

export const RESOURCE_INFO: Record<Resource, { name: string; color: number }> = {
  metallo: { name: 'Metallo', color: 0xa9bccb },
  benzina: { name: 'Benzina', color: 0xf2b84b },
  cibo: { name: 'Cibo', color: 0x9dbf6b },
};

export type Bag = Record<Resource, number>;

export const emptyBag = (): Bag => ({ metallo: 0, benzina: 0, cibo: 0 });
export const bagTotal = (b: Bag) => b.metallo + b.benzina + b.cibo;
export const scaleBag = (b: Bag, k: number): Bag => ({
  metallo: Math.floor(b.metallo * k),
  benzina: Math.floor(b.benzina * k),
  cibo: Math.floor(b.cibo * k),
});
export const addBag = (a: Bag, b: Bag): Bag => ({
  metallo: a.metallo + b.metallo,
  benzina: a.benzina + b.benzina,
  cibo: a.cibo + b.cibo,
});
