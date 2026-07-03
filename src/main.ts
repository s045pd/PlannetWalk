import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Terrain } from './world/Terrain';
import { FloatingOrigin } from './world/FloatingOrigin';
import { Physics } from './physics/Physics';
import { Player } from './player/Player';
import { citySiteAt, type CitySite } from './world/citySites';
import { Sky } from './sky/Sky';
import { DayNight } from './sky/DayNight';
import { Stars } from './sky/Stars';
import { DebrisRing } from './sky/DebrisRing';
import { PostFX } from './fx/PostFX';
import { Ruins } from './world/Ruins';
import { Scatter } from './world/Scatter';
import { WeatherSystem } from './weather/WeatherSystem';
import { Particles } from './weather/Particles';
import { Lightning } from './weather/Lightning';
import type { WeatherName } from './weather/weatherStates';

const SEED = 20260703;

/** 由原点向外环搜最近城市站点（种子确定性，必能找到） */
function findSpawnCity(seed: number): CitySite {
  for (let r = 0; r < 64; r++) {
    for (let cx = -r; cx <= r; cx++) {
      for (let cz = -r; cz <= r; cz++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
        const site = citySiteAt(seed, cx, cz);
        if (site) return site;
      }
    }
  }
  throw new Error('no city site found within search range');
}

async function init(): Promise<void> {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const engine = new Engine(canvas);
  engine.scene.fog = new THREE.Fog(0x8a7a66, 200, 900);

  const sky = new Sky(engine.scene);
  const dayNight = new DayNight(engine, sky);
  const stars = new Stars(engine.scene, SEED);
  const debrisRing = new DebrisRing(engine.scene, SEED);
  const postfx = new PostFX(engine);

  const origin = new FloatingOrigin();

  // 出生点：最近城市边缘外 80m，面向城市
  const city = findSpawnCity(SEED);
  const spawnDir = Math.PI * 0.25;
  const spawnWorld = new THREE.Vector3(
    city.x + Math.cos(spawnDir) * (city.radius + 80),
    0,
    city.z + Math.sin(spawnDir) * (city.radius + 80),
  );

  let playerRef: Player | null = null;
  const worldFocus = (): { x: number; z: number } => {
    if (!playerRef) return { x: spawnWorld.x, z: spawnWorld.z };
    const w = playerRef.worldPosition();
    return { x: w.x, z: w.z };
  };

  const terrain = new Terrain(engine.scene, SEED, worldFocus);
  spawnWorld.y = terrain.heightAt(spawnWorld.x, spawnWorld.z) + 1.6;

  const physics = await Physics.create(terrain, origin, worldFocus);
  const ruins = new Ruins(engine.scene, SEED, terrain.hf, origin, physics, worldFocus);
  const scatter = new Scatter(engine.scene, SEED, terrain.hf, origin, worldFocus);
  const weather = new WeatherSystem(engine, dayNight, sky, terrain);
  const particles = new Particles(engine, weather, SEED);
  const lightning = new Lightning(engine, sky, weather);
  const player = new Player(engine, physics, origin, spawnWorld.clone());
  player.yaw = Math.atan2(spawnWorld.x - city.x, spawnWorld.z - city.z);
  playerRef = player;

  origin.onShift((_, total) => terrain.shiftOrigin(total));

  engine.add(player);
  engine.add(physics);
  engine.add(terrain);
  engine.add(ruins);
  engine.add(scatter);
  engine.add(dayNight);
  engine.add(weather);
  engine.add(particles);
  engine.add(lightning);
  engine.add({
    update(dt) {
      stars.update(engine.camera.position, dayNight.sunElevation);
      debrisRing.update(engine.camera.position, dayNight.sunElevation, dt);
      origin.check(player.localPosition());
    },
  });

  engine.start();

  // 地形碰撞就绪后激活玩家
  const gate = setInterval(() => {
    const w = player.worldPosition();
    if (terrain.isReadyAround(1) && physics.hasColliderUnder(w.x, w.z)) {
      player.active = true;
      window.__game.ready = true;
      clearInterval(gate);
    }
  }, 200);

  window.__game.setTimeOfDay = (t: number) => {
    dayNight.timeOfDay = ((t % 1) + 1) % 1;
  };
  window.__game.setView = (yaw: number, pitch: number) => {
    player.yaw = yaw;
    player.pitch = pitch;
  };
  window.__game.setWeather = (name: string, duration = 3) => {
    weather.setWeather(name as WeatherName, duration);
  };
  window.__game.teleport = (x: number, z: number) => {
    const y = terrain.heightAt(x, z) + 1.5;
    player.teleportLocal(
      new THREE.Vector3(x - origin.totalOffset.x, y, z - origin.totalOffset.z),
    );
  };
  window.__game.teleportToCity = () => {
    window.__game.teleport!(city.x, city.z);
  };
  window.__game.debug = { engine, sky, dayNight, debrisRing, postfx, physics, ruins, weather };
  window.__game.playerPos = () => {
    const w = player.worldPosition();
    return { x: w.x, y: w.y, z: w.z };
  };
  window.__game.groundHeight = () => {
    const w = player.worldPosition();
    return terrain.heightAt(w.x, w.z);
  };
}

declare global {
  interface Window {
    __game: {
      ready: boolean;
      playerPos?: () => { x: number; y: number; z: number };
      groundHeight?: () => number;
      setTimeOfDay?: (t: number) => void;
      setView?: (yaw: number, pitch: number) => void;
      setWeather?: (name: string, duration?: number) => void;
      teleport?: (x: number, z: number) => void;
      teleportToCity?: () => void;
      debug?: Record<string, unknown>;
    };
  }
}
window.__game = { ready: false };

init().catch((err) => {
  console.error('[init]', err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem">初始化失败: ${String(err)}</pre>`;
});
