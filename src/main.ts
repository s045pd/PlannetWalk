import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Terrain } from './world/Terrain';

const SEED = 20260703;

const canvas = document.getElementById('app') as HTMLCanvasElement;
const engine = new Engine(canvas);
engine.scene.background = new THREE.Color(0x8a7a66);
engine.scene.fog = new THREE.Fog(0x8a7a66, 200, 900);

const sun = new THREE.DirectionalLight(0xfff2df, 2.2);
sun.position.set(300, 400, 200);
engine.scene.add(sun);
engine.scene.add(new THREE.HemisphereLight(0xcbd8ee, 0x51443a, 0.7));

// 临时自由飞行相机（Task 7 由 Player 替换）
const camPos = new THREE.Vector3(0, 0, 0);
let yaw = 0;
let pitch = -0.2;

const terrain = new Terrain(engine.scene, SEED, () => ({ x: camPos.x, z: camPos.z }));
camPos.y = terrain.heightAt(0, 0) + 30;

engine.add({
  update(dt) {
    const m = engine.input.consumeMouse();
    yaw -= m.dx * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - m.dy * 0.002));
    const speed = engine.input.isDown('ShiftLeft') ? 120 : 30;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (engine.input.isDown('KeyW')) camPos.addScaledVector(fwd, speed * dt);
    if (engine.input.isDown('KeyS')) camPos.addScaledVector(fwd, -speed * dt);
    if (engine.input.isDown('KeyD')) camPos.addScaledVector(right, speed * dt);
    if (engine.input.isDown('KeyA')) camPos.addScaledVector(right, -speed * dt);
    if (engine.input.isDown('KeyE')) camPos.y += speed * dt;
    if (engine.input.isDown('KeyQ')) camPos.y -= speed * dt;
    const minY = terrain.heightAt(camPos.x, camPos.z) + 2;
    if (camPos.y < minY) camPos.y = minY;
    engine.camera.position.copy(camPos);
    engine.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    terrain.update(dt);
  },
});

engine.start();

declare global {
  interface Window {
    __game: { ready: boolean };
  }
}
window.__game = { ready: false };
const readyCheck = setInterval(() => {
  if (terrain.isReadyAround(1)) {
    window.__game.ready = true;
    clearInterval(readyCheck);
  }
}, 250);
