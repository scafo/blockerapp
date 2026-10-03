// Le 3 risorse della run e il loro zaino.
import type { Resource } from '../config/balance';

export const RESOURCES: Resource[] = ['rottami', 'carburante', 'viveri'];

export const RESOURCE_INFO: Record<Resource, { name: string; color: number }> = {
  rottami: { name: 'Rottami', color: 0xc2552e },
  carburante: { name: 'Carburante', color: 0xc8963e },
  viveri: { name: 'Viveri', color: 0x9dbf6b },
};

export type Bag = Record<Resource, number>;

export const emptyBag = (): Bag => ({ rottami: 0, carburante: 0, viveri: 0 });
export const bagTotal = (b: Bag) => b.rottami + b.carburante + b.viveri;
export const scaleBag = (b: Bag, k: number): Bag => ({
  rottami: Math.floor(b.rottami * k),
  carburante: Math.floor(b.carburante * k),
  viveri: Math.floor(b.viveri * k),
});
export const addBag = (a: Bag, b: Bag): Bag => ({
  rottami: a.rottami + b.rottami,
  carburante: a.carburante + b.carburante,
  viveri: a.viveri + b.viveri,
});
