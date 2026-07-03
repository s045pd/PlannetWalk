import * as THREE from 'three';
import { Engine } from './core/Engine';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const engine = new Engine(canvas);
engine.scene.background = new THREE.Color(0x0a0d14);
engine.camera.position.set(0, 1.7, 4);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xc96f3b }),
);
engine.scene.add(box);
engine.scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x3a2f28, 1.2));

engine.add({
  update(dt) {
    box.rotation.y += dt;
    box.rotation.x += dt * 0.6;
  },
});

engine.start();
