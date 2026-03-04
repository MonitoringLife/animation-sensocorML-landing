import * as THREE from 'three';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf5f5f5);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ 
    canvas: document.querySelector('#webgl'), 
    antialias: true,
    alpha: true 
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const material = new THREE.ShaderMaterial({
    uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.25 },
        uIntro: { value: 0 }
    },
    vertexShader: `
        uniform float uTime;
        uniform float uSpeed;
        uniform float uIntro;
        varying vec2 vUv;
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vPos;
        varying float vAcross;
        varying float vWorldX;
        
        float ecgValue(float x) {
            x = fract(x);
            float y = 0.0;
            y += 0.12 * exp(-pow((x - 0.12) * 12.0, 2.0));   // P wave
            y -= 0.05 * exp(-pow((x - 0.32) * 25.0, 2.0));   // Q dip
            y += 0.85 * exp(-pow((x - 0.38) * 13.0, 2.0));   // R spike
            y -= 0.08 * exp(-pow((x - 0.44) * 20.0, 2.0));   // S dip
            y += 0.15 * exp(-pow((x - 0.65) * 6.0, 2.0));    // T wave
            return y;
        }
        
        void main() {
            vUv = uv;
            
            float t = uv.x;
            float across = uv.y - 0.5;
            vAcross = across;
            
            float worldX = (t - 0.5) * 20.0;
            vWorldX = worldX;
            float ecgX = worldX * 0.5 - uTime * uSpeed;
            float baseY = ecgValue(ecgX);
            
            // Thinner tube for clearer QRS
            float ribbonRadius = 0.12;
            
            float angle = across * 3.14159;
            float crossY = sin(angle) * ribbonRadius;
            float crossZ = cos(angle) * ribbonRadius;
            
            vec3 pos;
            pos.x = worldX;
            pos.y = baseY + crossY;
            pos.z = crossZ;
            
            // Subtle wave in Z
            pos.z += sin(worldX * 0.3 + uTime * 0.4) * 0.15;
            pos.y += sin(worldX * 0.15 + uTime * 0.2) * 0.03;
            
            vElevation = baseY;
            vPos = pos;
            
            // Normal: outward from tube center
            vec3 center = vec3(worldX, baseY, sin(worldX * 0.3 + uTime * 0.4) * 0.15);
            vNormal = normalize(pos - center);
            if (vNormal.z < 0.0) vNormal.z *= -0.3;
            vNormal = normalize(vNormal);
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vPos;
        varying float vAcross;
        varying float vWorldX;
        
        // Smooth HSV-like color cycle to avoid hard seams
        vec3 palette(float t) {
            vec3 color1 = vec3(0.9, 0.3, 0.6);  // Pink
            vec3 color2 = vec3(0.6, 0.4, 0.9);  // Purple
            vec3 color3 = vec3(0.4, 0.7, 1.0);  // Cyan
            vec3 color4 = vec3(0.2, 0.8, 0.7);  // Teal
            
            // 4-stop smooth loop: pink → purple → cyan → teal → pink
            t = fract(t);
            float segment = t * 4.0;
            
            if (segment < 1.0) {
                return mix(color1, color2, segment);
            } else if (segment < 2.0) {
                return mix(color2, color3, segment - 1.0);
            } else if (segment < 3.0) {
                return mix(color3, color4, segment - 2.0);
            } else {
                return mix(color4, color1, segment - 3.0);
            }
        }
        
        void main() {
            // Slow, smooth gradient based on world position
            float colorT = vWorldX * 0.015 - uTime * 0.03;
            
            vec3 finalColor = palette(colorT);
            
            // Matte medical lighting - soft diffuse, minimal specular
            vec3 lightDir = normalize(vec3(0.3, 0.5, 1.0));
            vec3 norm = normalize(vNormal);
            float diff = max(dot(norm, lightDir), 0.0) * 0.4 + 0.6;
            
            // Very subtle specular - just enough to show form
            vec3 viewDir = vec3(0.0, 0.0, 1.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float specular = pow(max(dot(norm, halfDir), 0.0), 80.0) * 0.08;
            
            // Subtle ambient occlusion on edges of tube
            float ao = 0.85 + 0.15 * abs(dot(norm, viewDir));
            
            finalColor = finalColor * diff * ao + specular;
            
            gl_FragColor = vec4(finalColor, 1.0);
        }
    `,
    side: THREE.DoubleSide,
    depthWrite: true
});

const geometry = new THREE.PlaneGeometry(1, 1, 500, 32);
const wave = new THREE.Mesh(geometry, material);
scene.add(wave);

// ============================================================
// PCG (Phonocardiogram) - Heart Sound Columns
// Palette: Dark Blue base → Cyan → Menta → Yellow pollito tip
// ============================================================

const PCG_COUNT = 18;

const pcgMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uTime: { value: 0 },
        uIntro: { value: 0 },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uIntro;

        attribute vec3 aOffset;
        attribute float aPhase;

        varying float vHeight;
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vAcross;
        varying float vColumnIdx;

        float heartbeat(float t) {
            t = fract(t);
            float s1 = 0.7 * exp(-pow((t - 0.10) * 5.5, 2.0));
            s1 += 0.35 * exp(-pow((t - 0.16) * 6.0, 2.0));
            float s2 = 0.4 * exp(-pow((t - 0.38) * 7.0, 2.0));
            float diastole = 0.08 * (1.0 + sin(t * 6.2832 * 1.5) * 0.3);
            return s1 + s2 + diastole;
        }

        float hash(float n) { return fract(sin(n) * 43758.5453); }
        float noise1D(float x) {
            float i = floor(x);
            float f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(hash(i), hash(i + 1.0), f);
        }

        void main() {
            float colX = aOffset.x;
            float colIdx = aOffset.y;
            float colZ = aOffset.z;
            float phase = aPhase;
            vColumnIdx = colIdx;

            float heightT = uv.y;
            float angle = uv.x * 6.2832;
            vAcross = uv.x;

            float bpm = 62.0;
            float cycleLen = 60.0 / bpm;
            float hbTime = uTime / cycleLen + phase;

            float propagation = colIdx * 0.025;
            float hbVal = heartbeat(hbTime - propagation);

            float n = noise1D(colIdx * 7.3 + uTime * 0.4) * 0.06;
            float n2 = noise1D(colIdx * 3.1 + uTime * 0.6) * 0.03;
            hbVal += n + n2;
            hbVal = max(hbVal, 0.08);

            float breathe = 0.1 + 0.04 * sin(uTime * 0.8 + colIdx * 0.5);
            hbVal = mix(breathe, hbVal, 0.75);

            vElevation = hbVal;
            vHeight = heightT;

            float maxHeight = 3.2;
            float colRadius = 0.11;

            float taper = 1.0 - smoothstep(0.7, 1.0, heightT);
            float dome = sqrt(max(0.0, 1.0 - pow((heightT - 0.85) / 0.15, 2.0)));
            float radiusScale = heightT < 0.85 ? taper : dome * 0.6;
            radiusScale = max(radiusScale, 0.0);
            float r = colRadius * (0.7 + 0.3 * radiusScale);

            float sway = sin(uTime * 0.35 + colIdx * 0.8 + phase * 2.0) * 0.08 * heightT;
            sway += sin(uTime * 0.5 + colIdx * 0.5) * 0.04 * heightT * heightT;

            vec3 pos;
            pos.x = colX + cos(angle) * r + sway;
            pos.y = heightT * maxHeight * hbVal - 0.29;
            pos.z = colZ + sin(angle) * r;
            pos.z += sin(uTime * 0.25 + colX * 0.3) * 0.06 * heightT;

            vWorldPos = pos;

            vec3 center = vec3(colX + sway, pos.y, colZ + sin(uTime * 0.25 + colX * 0.3) * 0.06 * heightT);
            vNormal = normalize(pos - center);

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;

        varying float vHeight;
        varying float vElevation;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vAcross;
        varying float vColumnIdx;

        vec3 pcgPalette(float h, float elev) {
            vec3 cLow  = vec3(0.08, 0.12, 0.35);  // Azul oscuro (base)
            vec3 cMid1 = vec3(0.15, 0.55, 0.65);  // Cyan oscuro
            vec3 cMid2 = vec3(0.35, 0.78, 0.72);  // Cyan claro / menta
            vec3 cHigh = vec3(0.94, 0.90, 0.51);  // Amarillo pollito (tip)

            float t = h * elev;
            t = clamp(t * 1.5, 0.0, 1.0);

            if (t < 0.33) {
                return mix(cLow, cMid1, t / 0.33);
            } else if (t < 0.66) {
                return mix(cMid1, cMid2, (t - 0.33) / 0.33);
            } else {
                return mix(cMid2, cHigh, (t - 0.66) / 0.34);
            }
        }

        void main() {
            vec3 baseColor = pcgPalette(vHeight, vElevation);

            float iridShift = sin(vWorldPos.y * 1.5 + uTime * 0.3 + vColumnIdx * 0.6) * 0.05;
            baseColor += iridShift;

            vec3 lightDir = normalize(vec3(0.4, 0.6, 0.8));
            vec3 norm = normalize(vNormal);
            float diff = max(dot(norm, lightDir), 0.0) * 0.55 + 0.45;

            vec3 viewDir = normalize(vec3(0.0, 0.2, 1.0));
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(norm, halfDir), 0.0), 60.0) * 0.5;

            float fresnel = pow(1.0 - abs(dot(norm, viewDir)), 3.0) * 0.4;

            float sss = pow(max(dot(-norm, lightDir), 0.0), 2.0) * 0.12;
            vec3 sssColor = vec3(0.7, 0.9, 0.5) * sss;

            vec3 finalColor = baseColor * diff + spec + fresnel * baseColor * 0.5 + sssColor;

            float tipFade = 1.0 - smoothstep(0.88, 1.0, vHeight);
            float depthFade = 0.65 + 0.35 * (1.0 - abs(vWorldPos.z) * 0.15);
            float alpha = 0.25 * tipFade * depthFade;

            gl_FragColor = vec4(finalColor, alpha);
        }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
});

// Build instanced column geometry
const pcgSegH = 40;
const pcgSegR = 16;

function buildPCGGeometry() {
    const vertCount = (pcgSegR + 1) * (pcgSegH + 1);
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);

    let vi = 0, ui = 0;
    for (let h = 0; h <= pcgSegH; h++) {
        for (let r = 0; r <= pcgSegR; r++) {
            positions[vi++] = 0;
            positions[vi++] = 0;
            positions[vi++] = 0;
            uvs[ui++] = r / pcgSegR;
            uvs[ui++] = h / pcgSegH;
        }
    }

    const indices = [];
    for (let h = 0; h < pcgSegH; h++) {
        for (let r = 0; r < pcgSegR; r++) {
            const a = h * (pcgSegR + 1) + r;
            indices.push(a, a + 1, a + (pcgSegR + 1));
            indices.push(a + 1, a + (pcgSegR + 1) + 1, a + (pcgSegR + 1));
        }
    }

    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.instanceCount = PCG_COUNT;

    const offsets = new Float32Array(PCG_COUNT * 3);
    const phases = new Float32Array(PCG_COUNT);
    const spread = 16;

    for (let i = 0; i < PCG_COUNT; i++) {
        const t = i / (PCG_COUNT - 1);
        offsets[i * 3 + 0] = (t - 0.5) * spread;
        offsets[i * 3 + 1] = i;
        offsets[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
        phases[i] = Math.random() * 0.3;
    }

    geom.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geom.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    return geom;
}

const pcgGeometry = buildPCGGeometry();
const pcgMesh = new THREE.Mesh(pcgGeometry, pcgMaterial);
scene.add(pcgMesh);

// ============================================================
// PPG (Photoplethysmography) - Data Particle Flow
// Palette: Dark blood red → Arterial red → Coral → Orange-red
// ============================================================

const PPG_COUNT = 3000;

function ppgWave(x) {
    x = x - Math.floor(x);
    let y = 0;
    y += 1.0 * Math.exp(-Math.pow((x - 0.15) * 7.0, 2));
    y -= 0.3 * Math.exp(-Math.pow((x - 0.32) * 12.0, 2));
    y += 0.5 * Math.exp(-Math.pow((x - 0.42) * 7.0, 2));
    y += 0.15 * Math.exp(-Math.pow((x - 0.6) * 4.0, 2));
    y += 0.02;
    return y;
}

function ppgSmoothstep(edge0, edge1, x) {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0.0), 1.0);
    return t * t * (3.0 - 2.0 * t);
}

const ppgPositions = new Float32Array(PPG_COUNT * 3);
const ppgColors = new Float32Array(PPG_COUNT * 3);
const ppgParticleData = [];

for (let i = 0; i < PPG_COUNT; i++) {
    ppgParticleData.push({
        phase: Math.random(),
        speed: 0.8 + Math.random() * 0.5,
        yOff: (Math.random() - 0.5) * 0.15,
        zPos: (Math.random() - 0.5) * 2.0,
    });
}

const ppgGeo = new THREE.BufferGeometry();
ppgGeo.setAttribute('position', new THREE.BufferAttribute(ppgPositions, 3));
ppgGeo.setAttribute('color', new THREE.BufferAttribute(ppgColors, 3));

const ppgMaterial = new THREE.PointsMaterial({
    size: 0.08,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.NormalBlending,
    depthWrite: false,
});

const ppgPoints = new THREE.Points(ppgGeo, ppgMaterial);
scene.add(ppgPoints);

function updatePPG(time) {
    for (let i = 0; i < PPG_COUNT; i++) {
        const p = ppgParticleData[i];
        const flowSpeed = 0.25 * p.speed;

        let t = (p.phase + time * flowSpeed * 0.08) % 1.0;

        const worldX = (t - 0.5) * 22.0;
        const waveX = t * 1.8 - time * 0.05 * p.speed;
        const baseY = ppgWave(waveX) * 1.2;
        const worldY = baseY + p.yOff;
        const worldZ = p.zPos;

        ppgPositions[i * 3 + 0] = worldX;
        ppgPositions[i * 3 + 1] = worldY;
        ppgPositions[i * 3 + 2] = worldZ;

        const colorMix = Math.min(Math.max(baseY * 1.5, 0.0), 1.0);
        ppgColors[i * 3 + 0] = 0.45 + colorMix * 0.53;
        ppgColors[i * 3 + 1] = 0.04 + colorMix * 0.45;
        ppgColors[i * 3 + 2] = 0.02 + colorMix * 0.18;
    }
    ppgGeo.attributes.position.needsUpdate = true;
    ppgGeo.attributes.color.needsUpdate = true;
}

camera.position.z = 10;
camera.position.y = 0.5;

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    material.uniforms.uTime.value = elapsed;
    pcgMaterial.uniforms.uTime.value = elapsed;
    updatePPG(elapsed);
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});