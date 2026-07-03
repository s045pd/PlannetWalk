import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  Effect,
  BloomEffect,
  VignetteEffect,
  NoiseEffect,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  BlendFunction,
} from 'postprocessing';
import type { Engine } from '../core/Engine';

/** 曝光效果：位于色调映射之前，读取 renderer.toneMappingExposure（DayNight 继续驱动它） */
class ExposureEffect extends Effect {
  constructor() {
    super(
      'ExposureEffect',
      /* glsl */ `
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`,
      { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) },
    );
  }

  set exposure(v: number) {
    this.uniforms.get('exposure')!.value = v;
  }
}

/** 后处理管线：bloom / 曝光 / ACES 色调映射 / 暗角 / 镜头颗粒 / SMAA */
export class PostFX {
  private composer: EffectComposer;
  private exposureFx = new ExposureEffect();
  readonly bloom: BloomEffect;

  constructor(engine: Engine) {
    // 场景以线性 HDR 渲染进半浮点缓冲，色调映射交给 EffectPass
    engine.renderer.toneMapping = THREE.NoToneMapping;
    this.composer = new EffectComposer(engine.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.composer.addPass(new RenderPass(engine.scene, engine.camera));

    this.bloom = new BloomEffect({
      intensity: 0.75,
      luminanceThreshold: 0.95,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ darkness: 0.55, offset: 0.28 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.COLOR_DODGE });
    noise.blendMode.opacity.value = 0.045;
    const smaa = new SMAAEffect();

    this.composer.addPass(new EffectPass(engine.camera, this.bloom, this.exposureFx, tone));
    this.composer.addPass(new EffectPass(engine.camera, vignette, noise, smaa));

    engine.renderOverride = (dt) => {
      this.exposureFx.exposure = engine.renderer.toneMappingExposure;
      this.composer.render(dt);
    };
    window.addEventListener('resize', () =>
      this.composer.setSize(window.innerWidth, window.innerHeight),
    );
  }

  setQuality(tier: 'low' | 'medium' | 'high'): void {
    this.bloom.blendMode.opacity.value = tier === 'low' ? 0 : 1;
  }
}
