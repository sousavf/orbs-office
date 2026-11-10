import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Daylight } from '../daylight';
import type { LightLevels } from '../lighting-model';

/** The outer strip dissolves into the same colour used behind the canvas. */
export class ExteriorGround {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly extentUniform = { value: 180 };
  private readonly dayUniform = { value: 1 };
  private readonly backdropUniform = { value: new Color(0xf6ead9) };

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uExtent: this.extentUniform,
        uDay: this.dayUniform,
        uBackdrop: this.backdropUniform,
      },
      vertexShader: `
        varying vec2 vGround;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vGround = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uExtent;
        uniform float uDay;
        uniform vec3 uBackdrop;
        varying vec2 vGround;
        void main() {
          float edge = max(abs(vGround.x - 25.0), abs(vGround.y - 12.0));
          float fade = 1.0 - smoothstep(uExtent + 4.0, uExtent + 48.0, edge);
          float grain = 0.85 + 0.1 * sin(vGround.x * 0.41) * sin(vGround.y * 0.37)
            + 0.04 * sin(vGround.x * 1.13 + vGround.y * 0.87);
          // Shader colours are linear; these night values stay dark after display conversion.
          vec3 grass = mix(vec3(0.007, 0.014, 0.015), vec3(0.49, 0.58, 0.39), uDay) * grain;
          gl_FragColor = vec4(mix(uBackdrop, grass, fade), fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.material);
    this.mesh.position.set(25, -0.65, 12);
    this.mesh.renderOrder = -1;
  }

  setExtent(halfExtent: number): void {
    this.mesh.scale.set(halfExtent + 52, 1, halfExtent + 52);
    this.extentUniform.value = halfExtent;
  }

  setLighting(levels: LightLevels, daylight: Daylight): void {
    this.dayUniform.value = daylight.dayFactor;
    this.backdropUniform.value.set(levels.backdrop.bg);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
