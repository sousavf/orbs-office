/**
 * One quad per character, composited in a single fragment pass: legs, shirt or dress (tinted),
 * accent (tinted), hands, then the head. Everything is premultiplied and blended with "over" in the
 * shader, so the quad writes depth once with alpha-to-coverage edges and needs no sorting.
 */

export const CHARACTER_VERTEX = /* glsl */ `
  uniform vec2 uSize;
  uniform float uBias;
  varying vec2 vFrame;

  void main() {
    vec3 anchor = modelMatrix[3].xyz;
    vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
    right = right / max(length(right), 1e-4);
    vec3 world = anchor + right * (position.x * uSize.x) + vec3(0.0, position.y * uSize.y, 0.0);
    vec4 view = viewMatrix * vec4(world, 1.0);
    view.z += uBias;
    gl_Position = projectionMatrix * view;
    vFrame = vec2(uv.x * 32.0, (1.0 - uv.y) * 48.0);
  }
`;

export const CHARACTER_FRAGMENT = /* glsl */ `
  uniform sampler2D uLegs;
  uniform sampler2D uUpper;
  uniform sampler2D uAccent;
  uniform sampler2D uHands;
  uniform sampler2D uHeads;
  uniform sampler2D uAvatar;
  uniform vec4 uRect;
  uniform vec4 uHeadRect;
  uniform vec3 uHead;
  uniform float uFlip;
  uniform float uOpacity;
  uniform float uAccentOn;
  uniform vec3 uTint;
  uniform vec3 uAccentTint;
  uniform vec3 uRing;
  uniform vec3 uLight;
  varying vec2 vFrame;

  vec4 over(vec4 src, vec4 dst) {
    return src + dst * (1.0 - src.a);
  }

  vec4 tinted(sampler2D sheet, vec2 uv, vec3 tint) {
    vec2 s = texture2D(sheet, uv).rg;
    float l = clamp(s.r / max(s.g, 0.004), 0.0, 1.0);
    return vec4(pow(l, 2.2) * tint * s.g, s.g);
  }

  void main() {
    vec2 p = vFrame;
    vec2 body = vec2(mix(p.x, 32.0 - p.x, uFlip) / 32.0, 1.0 - p.y / 48.0);
    vec2 uv = uRect.xy + body * uRect.zw;

    vec4 c = texture2D(uLegs, uv);
    c = over(tinted(uUpper, uv, uTint), c);
    vec4 accent = tinted(uAccent, uv, uAccentTint);
    c = over(accent * uAccentOn, c);
    c = over(texture2D(uHands, uv), c);

    vec2 hp = p - uHead.xy;
    vec2 cell = hp + vec2(14.0, 14.0);
    vec2 cellInside = step(vec2(0.0), cell) * step(cell, vec2(28.0, 32.0));
    vec2 headUv = uHeadRect.xy + vec2(clamp(cell.x, 0.0, 28.0) / 28.0, 1.0 - clamp(cell.y, 0.0, 32.0) / 32.0) * uHeadRect.zw;
    vec4 plain = texture2D(uHeads, headUv) * (cellInside.x * cellInside.y);

    // The avatar fills its disc edge to edge, so it is drawn smaller than the plain head's cell
    // and lowered by the difference to stay seated on the neck.
    float radius = 7.0;
    vec2 ap = hp - vec2(0.0, 3.0);
    float r = length(ap);
    float edge = max(fwidth(r), 0.05);
    float disc = 1.0 - smoothstep(radius - edge, radius + edge, r);
    vec4 face = texture2D(uAvatar, clamp(vec2(0.5 + ap.x / (2.0 * radius), 0.5 - ap.y / (2.0 * radius)), 0.0, 1.0));
    vec3 base = mix(vec3(0.82, 0.79, 0.74), face.rgb, face.a);
    vec4 avatar = vec4(base * disc, disc);

    vec4 head = mix(plain, avatar, step(0.5, uHead.z));
    c = over(head, c);

    float a = c.a;
    if (a < 0.004) discard;
    float aa = clamp((a - 0.5) / max(fwidth(a), 1e-4) + 0.5, 0.0, 1.0) * uOpacity;
    if (aa < 0.01) discard;
    gl_FragColor = vec4(c.rgb / a * uLight, aa);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
