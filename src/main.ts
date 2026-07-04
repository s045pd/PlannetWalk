import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Terrain } from './world/Terrain';
import { FloatingOrigin } from './world/FloatingOrigin';
import { Physics } from './physics/Physics';
import { Player } from './player/Player';
import { citySiteAt, type CitySite } from './world/citySites';
import { smoothstep } from './world/noise';
import { Sky } from './sky/Sky';
import { DayNight } from './sky/DayNight';
import { Stars } from './sky/Stars';
import { DebrisRing } from './sky/DebrisRing';
import { Aurora } from './sky/Aurora';
import { PostFX } from './fx/PostFX';
import { Ruins } from './world/Ruins';
import { Scatter } from './world/Scatter';
import { VehicleManager } from './vehicles/Rideable';
import { Rover } from './vehicles/Rover';
import { Hovercraft } from './vehicles/Hovercraft';
import { Hud } from './hud/Hud';
import { PhotoMode } from './player/PhotoMode';
import { Scanner } from './player/Scanner';
import { ParticlePool } from './fx/ParticlePool';
import { LogPickups } from './story/LogPickups';
import { SignalQuest } from './story/SignalQuest';
import { Ending } from './story/Ending';
import { Survey } from './story/Survey';
import { HoloMap } from './hud/HoloMap';
import { Waypoints } from './player/Waypoints';
import { PoiManager } from './world/PoiManager';
import { AudioSystem } from './audio/AudioSystem';
import { Settings, createDebugPanel } from './core/Settings';
import { SettingsMenu } from './hud/SettingsMenu';
import { loadSave, writeSave, clearSave, SAVE_VERSION } from './core/SaveGame';
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

  // 出生点：最近城市边缘外 80m，面向城市；有存档则回到存档位置
  const save = loadSave();
  const city = findSpawnCity(SEED);
  const spawnDir = Math.PI * 0.25;
  const spawnWorld = new THREE.Vector3(
    city.x + Math.cos(spawnDir) * (city.radius + 80),
    0,
    city.z + Math.sin(spawnDir) * (city.radius + 80),
  );
  if (save) spawnWorld.set(save.playerWorld.x, save.playerWorld.y, save.playerWorld.z);

  let playerRef: Player | null = null;
  const worldFocus = (): { x: number; z: number } => {
    if (!playerRef) return { x: spawnWorld.x, z: spawnWorld.z };
    const w = playerRef.worldPosition();
    return { x: w.x, z: w.z };
  };

  const terrain = new Terrain(engine.scene, SEED, worldFocus);
  if (!save) spawnWorld.y = terrain.heightAt(spawnWorld.x, spawnWorld.z) + 1.6;

  const physics = await Physics.create(terrain, origin, worldFocus);
  const ruins = new Ruins(engine.scene, SEED, terrain.hf, origin, physics, worldFocus);
  const scatter = new Scatter(engine.scene, SEED, terrain.hf, origin, worldFocus);
  const weather = new WeatherSystem(engine, dayNight, sky, terrain);
  const particles = new Particles(engine, weather, SEED);
  const player = new Player(engine, physics, origin, spawnWorld.clone());
  const lightning = new Lightning(engine, sky, weather, player, terrain);
  const aurora = new Aurora(engine, weather, dayNight);
  player.yaw = Math.atan2(spawnWorld.x - city.x, spawnWorld.z - city.z);
  playerRef = player;

  // 载具停放在出生点旁
  const vehicles = new VehicleManager(engine, player);
  const parkDir = new THREE.Vector3(-Math.cos(spawnDir), 0, Math.sin(spawnDir));
  const roverPos = spawnWorld.clone().addScaledVector(parkDir, 8);
  roverPos.y = terrain.heightAt(roverPos.x, roverPos.z) + 1.6;
  const rover = new Rover(engine, physics, roverPos);
  const hoverPos = spawnWorld.clone().addScaledVector(parkDir, 16);
  hoverPos.y = terrain.heightAt(hoverPos.x, hoverPos.z) + 2.2;
  const hovercraft = new Hovercraft(engine, physics, terrain, origin, hoverPos);
  vehicles.add(rover);
  vehicles.add(hovercraft);
  // 地形碰撞就绪前冻结载具，防止坠穿
  rover.body.setGravityScale(0, false);
  hovercraft.body.setGravityScale(0, false);

  // 载具/喷气粒子池
  const dustPool = new ParticlePool(engine.scene, 700, {
    gravity: 0.9,
    grow: 3.2,
    opacity: 0.4,
  });
  const flamePool = new ParticlePool(engine.scene, 260, {
    additive: true,
    gravity: 0,
    grow: 1.4,
    opacity: 0.9,
  });
  rover.dust = dustPool;
  hovercraft.dust = dustPool;
  player.flames = flamePool;
  origin.onShift(() => {
    dustPool.clear();
    flamePool.clear();
  });
  engine.add(dustPool);
  engine.add(flamePool);

  origin.onShift((_, total) => terrain.shiftOrigin(total));

  const logPickups = new LogPickups(engine, SEED, terrain.hf, origin, player);
  const poiManager = new PoiManager(
    engine.scene,
    SEED,
    terrain.hf,
    origin,
    physics,
    logPickups,
    worldFocus,
  );
  const hud = new Hud(
    engine,
    player,
    dayNight,
    terrain,
    weather,
    vehicles,
    origin,
    logPickups,
    poiManager,
  );
  const audio = new AudioSystem(engine, player, weather, vehicles, terrain.hf);
  // 信号主线：出生城市边缘为路线起点（不受存档出生点影响，保证路线固定）
  const questSpawn = {
    x: city.x + Math.cos(spawnDir) * (city.radius + 80),
    z: city.z + Math.sin(spawnDir) * (city.radius + 80),
  };
  const quest = new SignalQuest(engine, SEED, questSpawn, terrain.hf, origin, player, audio);
  hud.quest = quest;
  const ending = new Ending(engine, weather, debrisRing);
  const settings = new Settings(engine, dayNight, terrain, particles, postfx);
  const photoMode = new PhotoMode(engine);
  const scanner = new Scanner(engine, player, poiManager, logPickups, origin, terrain.hf);
  const survey = new Survey(engine, player, poiManager, scanner, terrain.hf);
  const holoMap = new HoloMap(engine, player, terrain.hf, poiManager, survey, quest);
  const waypoints = new Waypoints(engine, player, origin);
  hud.waypoints = waypoints;
  holoMap.beaconsProvider = () => waypoints.beacons;
  holoMap.vehiclesProvider = () => {
    const rp = rover.body.translation();
    const hp = hovercraft.body.translation();
    const off = origin.totalOffset;
    return [
      { x: rp.x + off.x, z: rp.z + off.z, kind: 'rover' },
      { x: hp.x + off.x, z: hp.z + off.z, kind: 'hover' },
    ];
  };
  new SettingsMenu(engine, settings, audio, player);
  createDebugPanel(engine);

  // 存档恢复与自动写档
  if (save) {
    dayNight.timeOfDay = save.timeOfDay;
    weather.setWeather(save.weather as WeatherName, 0.5);
    logPickups.restore(save.collectedLogs, save.usedSpotKeys);
    settings.apply(save.quality);
    quest.restore(save.questStage);
    ending.restore(save.endingSeen);
    survey.restore(save.surveyedTowers);
    holoMap.restore(save.visitedChunks);
    waypoints.restore(save.beacons);
  }
  const doSave = (): void => {
    if (!window.__game.ready) return;
    const w = player.worldPosition();
    writeSave({
      version: SAVE_VERSION,
      playerWorld: { x: w.x, y: w.y, z: w.z },
      timeOfDay: dayNight.timeOfDay,
      weather: weather.core.current,
      collectedLogs: [...logPickups.collected],
      usedSpotKeys: [...logPickups.usedSpotKeys],
      quality: settings.tier,
      questStage: quest.stage,
      endingSeen: ending.seen,
      surveyedTowers: [...survey.surveyed],
      visitedChunks: [...holoMap.visited],
      beacons: [...waypoints.beacons],
      vehicles: { rover: null, hover: null },
      raceBest: {},
    });
  };
  setInterval(doSave, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) doSave();
  });

  engine.add(player);
  engine.add(vehicles);
  engine.add(physics);
  engine.add(terrain);
  engine.add(ruins);
  engine.add(scatter);
  engine.add(dayNight);
  engine.add(weather);
  engine.add(particles);
  engine.add(lightning);
  engine.add(aurora);
  engine.add(logPickups);
  engine.add(poiManager);
  engine.add(hud);
  engine.add(audio);
  engine.add(settings);
  engine.add(photoMode);
  engine.add(scanner);
  engine.add(quest);
  engine.add(survey);
  engine.add(holoMap);
  engine.add(waypoints);
  engine.add({
    update(dt) {
      stars.update(engine.camera.position, dayNight.sunElevation);
      debrisRing.update(engine.camera.position, dayNight.sunElevation, dt);
      ruins.setNightFactor(smoothstep(0.05, -0.12, dayNight.sunElevation));
      origin.check(player.localPosition());
    },
  });

  engine.start();

  // 地形碰撞就绪后激活玩家
  const gate = setInterval(() => {
    const w = player.worldPosition();
    if (terrain.isReadyAround(1) && physics.hasColliderUnder(w.x, w.z)) {
      player.active = true;
      rover.body.setGravityScale(1, true);
      hovercraft.body.setGravityScale(1, true);
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
  window.__game.getFps = () => engine.fps;
  window.__game.setQuality = (t: 'low' | 'medium' | 'high') => settings.apply(t);
  window.__game.saveNow = doSave;
  window.__game.resetSave = clearSave;
  window.__game.debug = {
    engine,
    sky,
    dayNight,
    debrisRing,
    postfx,
    physics,
    ruins,
    weather,
    vehicles,
    rover,
    hovercraft,
    player,
    logPickups,
    poiManager,
    hud,
    origin,
    lightning,
    scanner,
    quest,
    survey,
    ending,
    holoMap,
    waypoints,
  };
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
      getFps?: () => number;
      setQuality?: (t: 'low' | 'medium' | 'high') => void;
      saveNow?: () => void;
      resetSave?: () => void;
      debug?: Record<string, unknown>;
    };
  }
}
window.__game = { ready: false };

init().catch((err) => {
  console.error('[init]', err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem">初始化失败: ${String(err)}</pre>`;
});
