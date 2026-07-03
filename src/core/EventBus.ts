import type * as THREE from 'three';

export interface Events {
  'weather:changed': { state: string };
  'vehicle:entered': { kind: string };
  'vehicle:exited': Record<string, never>;
  'origin:shifted': { offset: THREE.Vector3 };
  'player:landed': { speed: number };
  'player:step': { biome: number };
  'weather:lightning': { delaySec: number };
  'player:shocked': { intensity: number };
  'log:collected': {
    id: string;
    title: string;
    body: string;
    already: boolean;
    total: number;
    count: number;
  };
}

type Handler<K extends keyof Events> = (payload: Events[K]) => void;

export class EventBus {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Handler<K>): void {
    this.handlers.get(event)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((fn) => (fn as Handler<K>)(payload));
  }
}
