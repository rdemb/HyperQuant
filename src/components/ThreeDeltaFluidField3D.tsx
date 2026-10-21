import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import * as d3 from 'd3';
import {
  Activity,
  Camera,
  ChevronDown,
  ChevronUp,
  Focus,
  Maximize2,
  Minimize2,
  RotateCcw,
  Waves,
  Zap,
} from 'lucide-react';
import {
  AggrTradeTick,
  OFIMomentumSummary,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

interface ThreeDeltaFluidField3DProps {
  bars: OHLCVBar[];
  trades: AggrTradeTick[];
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  ofiSummary: OFIMomentumSummary;
  currentPrice: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onTriggerFluidSignal?: (
    dir: 'LONG' | 'SHORT',
    title: string,
    reason: string
  ) => void;
}

type FluidCameraPreset = 'collision' | 'buywave' | 'sellwave' | 'topmap';

interface HoveredFluidCell {
  title: string;
  subtitle: string;
  buyPressurePsi: string;
  sellPressurePsi: string;
  netDeltaUsd: string;
  accentColor: string;
}

export const ThreeDeltaFluidField3D: React.FC<ThreeDeltaFluidField3DProps> = ({
  bars,
  trades,
  shaakuni,
  quant,
  ofiSummary,
  currentPrice,
  isExpanded = false,
  onToggleExpand,
  onTriggerFluidSignal,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [preset, setPreset] = useState<FluidCameraPreset>('collision');
  const [dofEnabled, setDofEnabled] = useState<boolean>(true);
  const [dofFocus, setDofFocus] = useState<number>(22);
  const [dofAperture, setDofAperture] = useState<number>(2.0);
  const [pressureGain, setPressureGain] = useState<number>(1.35);
  const [viscosityDamping, setViscosityDamping] = useState<number>(0.45);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [hoveredCell, setHoveredCell] = useState<HoveredFluidCell | null>(null);

  const latestRef = useRef({
    bars,
    trades,
    shaakuni,
    quant,
    ofiSummary,
    currentPrice,
    dofEnabled,
    dofFocus,
    dofAperture,
    pressureGain,
    viscosityDamping,
  });

  useEffect(() => {
    latestRef.current = {
      bars,
      trades,
      shaakuni,
      quant,
      ofiSummary,
      currentPrice,
      dofEnabled,
      dofFocus,
      dofAperture,
      pressureGain,
      viscosityDamping,
    };
  }, [
    bars,
    trades,
    shaakuni,
    quant,
    ofiSummary,
    currentPrice,
    dofEnabled,
    dofFocus,
    dofAperture,
    pressureGain,
    viscosityDamping,
  ]);

  const targetCamRef = useRef<{
    pos: THREE.Vector3;
    lookAt: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(0, 14.5, 22.5),
    lookAt: new THREE.Vector3(0, 0, 0),
    active: false,
  });

  const applyPreset = (p: FluidCameraPreset) => {
    setPreset(p);
    if (p === 'collision') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 14.5, 22.5),
        lookAt: new THREE.Vector3(0, 0, 0),
        active: true,
      };
    } else if (p === 'buywave') {
      targetCamRef.current = {
        pos: new THREE.Vector3(-19, 9.5, 13),
        lookAt: new THREE.Vector3(-2, 0.5, 0),
        active: true,
      };
    } else if (p === 'sellwave') {
      targetCamRef.current = {
        pos: new THREE.Vector3(19, 9.5, 13),
        lookAt: new THREE.Vector3(2, -0.5, 0),
        active: true,
      };
    } else if (p === 'topmap') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 29, 3.5),
        lookAt: new THREE.Vector3(0, 0, 0),
        active: true,
      };
    }
  };

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software WebGL Guard per Three.js guidelines
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(280, container.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060911);
    scene.fog = new THREE.FogExp2(0x060911, 0.014);

    // 2. Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 160);
    camera.position.set(0, 14.5, 22.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 56;
    controls.target.set(0, 0, 0);

    controls.addEventListener('start', () => {
      targetCamRef.current.active = false;
    });

    // 3. Three-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x060911, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    keyLight.position.set(16, 28, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const buyRimLight = new THREE.PointLight(0x06b6d4, 4.5, 32);
    buyRimLight.position.set(-12, 6, 0);
    scene.add(buyRimLight);

    const sellRimLight = new THREE.PointLight(0xf43f5e, 4.5, 32);
    sellRimLight.position.set(12, 6, 0);
    scene.add(sellRimLight);

    // 4. D3 Scales & Color Interpolator for Pressure-Sensitive Displacement Mesh
    // Maps normalized pressure [-1 (Extreme Sell Cavitation) .. 0 (Shock Boundary) .. +1 (Extreme Buy Crest)]
    const d3PressureColor = d3
      .scaleSequential<string>((t) =>
        d3.interpolateRgbBasis([
          '#be123c', // Deep Crimson Sell Trough
          '#f43f5e', // Aggressive Market Sell Wave
          '#475569', // Neutral Laminar Equilibrium
          '#facc15', // Collision Shockwave Boundary (Gold)
          '#06b6d4', // Aggressive Market Buy Wave
          '#10b981', // High-Intensity Purchase Crest
        ])(t)
      )
      .domain([-1, 1]);

    const d3DisplacementScale = d3
      .scaleLinear()
      .domain([-1, 1])
      .range([-3.2, 3.2]);

    // 5. Pressure-Sensitive Fluid Displacement Mesh (60 x 44 grid)
    const segX = 60;
    const segZ = 44;
    const meshWidth = 26;
    const meshDepth = 18;
    const fluidGeo = new THREE.PlaneGeometry(meshWidth, meshDepth, segX, segZ);
    fluidGeo.rotateX(-Math.PI / 2);

    const vertexCount = fluidGeo.attributes.position.count;
    const colorAttr = new THREE.BufferAttribute(
      new Float32Array(vertexCount * 3),
      3
    );
    fluidGeo.setAttribute('color', colorAttr);

    const fluidMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.18,
      metalness: 0.35,
      transmission: isSoftwareGl ? 0 : 0.42,
      transparent: true,
      opacity: 0.92,
      ior: 1.48,
      side: THREE.DoubleSide,
    });
    const fluidMesh = new THREE.Mesh(fluidGeo, fluidMat);
    fluidMesh.receiveShadow = !isSoftwareGl;
    fluidMesh.layers.enable(1);
    scene.add(fluidMesh);

    // Subtle Wireframe Overlay on the Fluid Surface for Precision Topographic Reading
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
    });
    const wireMesh = new THREE.Mesh(fluidGeo, wireMat);
    wireMesh.position.y = 0.015;
    scene.add(wireMesh);

    // Ground Reference Grid Pedestal
    const gridHelper = new THREE.GridHelper(28, 28, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -3.4;
    scene.add(gridHelper);

    // 6. Dynamic Collision Shockwave Boundary & Hydrodynamic Advection Stream Particles
    const shockLineGroup = new THREE.Group();
    const pressurePillarsGroup = new THREE.Group();
    scene.add(shockLineGroup, pressurePillarsGroup);

    // Create 36 Advected Fluid Stream Spheres (18 Buyer Cyan Jets moving right, 18 Seller Crimson Jets moving left)
    const streamParticlesGroup = new THREE.Group();
    scene.add(streamParticlesGroup);

    const fluidParticles: {
      mesh: THREE.Mesh;
      isBuyer: boolean;
      x: number;
      z: number;
      speed: number;
    }[] = [];

    const partGeo = new THREE.SphereGeometry(0.14, 10, 10);
    for (let i = 0; i < 36; i++) {
      const isBuyer = i < 18;
      const partMat = new THREE.MeshStandardMaterial({
        color: isBuyer ? 0x22d3ee : 0xf43f5e,
        emissive: isBuyer ? 0x06b6d4 : 0xe11d48,
        emissiveIntensity: 0.9,
        roughness: 0.15,
        metalness: 0.6,
      });
      const partMesh = new THREE.Mesh(partGeo, partMat);
      streamParticlesGroup.add(partMesh);

      fluidParticles.push({
        mesh: partMesh,
        isBuyer,
        x: isBuyer
          ? -meshWidth * 0.48 + (i % 9) * 1.3
          : meshWidth * 0.48 - (i % 9) * 1.3,
        z: ((i % 6) - 2.5) * 2.7,
        speed: 2.2 + (i % 5) * 0.45,
      });
    }

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const c = grp.children[0] as THREE.Mesh;
        if (c.geometry) c.geometry.dispose();
        grp.remove(c);
      }
    };

    // Rebuild Discrete Price-Tick Pressure Pillars & Collision Shock Ribbon
    let lastOverlayRebuild = 0;
    const rebuildPressurePillarsAndShockLine = (elapsed: number) => {
      const {
        ofiSummary: curOfi,
        quant: curQuant,
        currentPrice: curPx,
        pressureGain: curGain,
      } = latestRef.current;

      clearGroup(shockLineGroup);
      clearGroup(pressurePillarsGroup);

      // Shockfront X position shifts with net aggressive dominance (-4 to +4)
      const shockOffsetX = Math.max(
        -5.5,
        Math.min(5.5, curQuant.hawkesNetDominance * 4.5)
      );

      // Build glowing 3D Shockwave Collision Ribbon along the Z axis where Buyer & Seller fronts collide
      const shockPts: THREE.Vector3[] = [];
      for (let j = 0; j <= 16; j++) {
        const z = -meshDepth * 0.5 + (j / 16) * meshDepth;
        const waveX =
          shockOffsetX + Math.sin(z * 0.45 + elapsed * 2.2) * 0.85;
        const waveY =
          0.35 +
          Math.cos(z * 0.6 - elapsed * 1.8) * 0.45 * curGain;
        shockPts.push(new THREE.Vector3(waveX, waveY, z));
      }

      const shockCurve = new THREE.CatmullRomCurve3(shockPts);
      const shockTubeGeo = new THREE.TubeGeometry(
        shockCurve,
        36,
        0.09,
        8,
        false
      );
      const shockTubeMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.8,
      });
      const shockTubeMesh = new THREE.Mesh(shockTubeGeo, shockTubeMat);
      shockTubeMesh.layers.enable(1);
      shockTubeMesh.userData = {
        title: `Delta Collision Shockfront ($${curPx.toFixed(1)})`,
        subtitle: `Hawkes Dominance: ${(curQuant.hawkesNetDominance * 100).toFixed(1)}% · B/S Ratio: ${curOfi.overallBuySellRatio}x`,
        buyPressurePsi: `${curQuant.hawkesBuyIntensity.toFixed(1)}k Ψ`,
        sellPressurePsi: `${curQuant.hawkesSellIntensity.toFixed(1)}k Ψ`,
        netDeltaUsd: `OFI ${curOfi.overallOfiPct >= 0 ? '+' : ''}${curOfi.overallOfiPct}%`,
        accentColor: '#facc15',
      };
      shockLineGroup.add(shockTubeMesh);

      // Build Raycastable Tick Pressure Nodes from ofiSummary.ticks
      const ticks = curOfi.ticks.slice(0, 16);
      ticks.forEach((t, idx) => {
        const isBid = t.side === 'BID';
        const x = isBid
          ? -2.2 - (idx % 8) * 1.25
          : 2.2 + (idx % 8) * 1.25;
        const z = ((idx % 4) - 1.5) * 3.6;
        const netPressure = t.ofiNormalized * curGain;
        const h = Math.max(0.35, Math.min(3.4, Math.abs(netPressure) * 2.4 + 0.5));

        const nodeGeo = new THREE.CylinderGeometry(0.18, 0.24, h, 12);
        const colHex =
          t.exhaustionState !== 'NONE'
            ? 0xfacc15
            : t.ofiNormalized >= 0
            ? 0x06b6d4
            : 0xf43f5e;
        const nodeMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 0.5,
          roughness: 0.2,
          metalness: 0.85,
        });
        const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
        nodeMesh.position.set(x, -3.2 + h * 0.5, z);
        nodeMesh.layers.enable(1);
        nodeMesh.userData = {
          title: `Tick $${t.price.toFixed(1)} (${t.side}) Pressure Node`,
          subtitle: `Buy/Sell Ratio: ${t.buySellRatio.toFixed(2)}x · Exhaustion: ${t.exhaustionScore}%`,
          buyPressurePsi: `$${(t.aggressiveBuyUsd / 1000).toFixed(0)}K Buy`,
          sellPressurePsi: `$${(t.aggressiveSellUsd / 1000).toFixed(0)}K Sell`,
          netDeltaUsd: `${t.deltaUsd >= 0 ? '+' : ''}$${(t.deltaUsd / 1000).toFixed(0)}K`,
          accentColor:
            t.exhaustionState !== 'NONE'
              ? '#facc15'
              : t.ofiNormalized >= 0
              ? '#22d3ee'
              : '#f43f5e',
        };
        pressurePillarsGroup.add(nodeMesh);
      });
    };

    rebuildPressurePillarsAndShockLine(0);

    // Post-Processing Bokeh Depth of Field
    let composer: EffectComposer | null = null;
    let bokehPass: BokehPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bokehPass = new BokehPass(scene, camera, {
        focus: latestRef.current.dofFocus,
        aperture: latestRef.current.dofAperture * 0.0001,
        maxblur: 0.008,
      });
      composer.addPass(bokehPass);
      renderer.compile(scene, camera);
    }

    // Raycasting on Layer 1
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2(-99, -99);
    let lastRaycast = 0;

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastRaycast < 50) return;
      lastRaycast = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        [...shockLineGroup.children, ...pressurePillarsGroup.children],
        true
      );
      if (hits.length > 0 && hits[0].object.userData?.title) {
        setHoveredCell(hits[0].object.userData as HoveredFluidCell);
        return;
      }
      setHoveredCell(null);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);

    const handleResize = () => {
      if (!container) return;
      const w = Math.max(320, container.clientWidth);
      const h = Math.max(280, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Pre-allocated Color object for zero GC inside render loop
    const _tmpColor = new THREE.Color();
    const startTimeMs = performance.now();
    let prevTimeMs = startTimeMs;
    let frameId = 0;
    let isDisposed = false;
    let isVisible = true;

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              if (entries[0]) isVisible = entries[0].isIntersecting;
            },
            { threshold: 0.05 }
          )
        : null;
    io?.observe(container);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isDisposed) return;
      const nowMs = performance.now();
      const dt = Math.min(0.1, (nowMs - prevTimeMs) / 1000);
      prevTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (!isVisible) {
        frameId = window.setTimeout(tick, 250);
        return;
      }

      if (elapsed - lastOverlayRebuild > 0.45) {
        lastOverlayRebuild = elapsed;
        rebuildPressurePillarsAndShockLine(elapsed);
      }

      const {
        quant: curQuant,
        ofiSummary: curOfi,
        pressureGain: curGain,
        viscosityDamping: curVisc,
      } = latestRef.current;

      // Buyer vs Seller wave amplitudes driven by real-time Hawkes intensity & OFI ratio
      const buyAmp =
        Math.min(1.4, 0.55 + (curQuant.hawkesBuyIntensity / 120) * 0.65) *
        curGain;
      const sellAmp =
        Math.min(1.4, 0.55 + (curQuant.hawkesSellIntensity / 120) * 0.65) *
        curGain;
      const shockX = Math.max(
        -5.5,
        Math.min(5.5, curQuant.hawkesNetDominance * 4.5)
      );

      // 1. Update Pressure-Sensitive Fluid Displacement Mesh using D3 scales
      const posAttr = fluidGeo.attributes.position;
      const colAttr = fluidGeo.attributes.color;

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);

        // Distance from left (Buyer Wave source) and right (Seller Wave source)
        const distFromShock = vx - shockX;

        // Buyer hydrodynamic wave propagating from left (-X) toward shockfront
        const buyWave =
          distFromShock <= 1.5
            ? buyAmp *
              Math.exp(-Math.max(0, distFromShock + 4.5) * (0.12 + curVisc * 0.1)) *
              (0.65 +
                0.35 *
                  Math.sin(vx * 0.55 - elapsed * 2.8 + Math.cos(vz * 0.35)))
            : 0;

        // Seller hydrodynamic counter-wave propagating from right (+X) toward shockfront
        const sellWave =
          distFromShock >= -1.5
            ? -sellAmp *
              Math.exp(-Math.max(0, 4.5 - distFromShock) * (0.12 + curVisc * 0.1)) *
              (0.65 +
                0.35 *
                  Math.sin(-vx * 0.55 - elapsed * 2.8 + Math.sin(vz * 0.35)))
            : 0;

        // High-frequency turbulent ripple at the collision boundary
        const collisionTurbulence =
          Math.exp(-Math.pow(distFromShock, 2) / 2.2) *
          Math.sin(vz * 0.9 + elapsed * 4.5) *
          0.42 *
          (1 - curVisc * 0.5);

        const netPressureNorm = Math.max(
          -1,
          Math.min(1, buyWave + sellWave + collisionTurbulence)
        );

        const displacedY = d3DisplacementScale(netPressureNorm);
        posAttr.setY(i, displacedY);

        // Map pressure to RGB color via D3 interpolator
        const cssCol = d3PressureColor(netPressureNorm);
        _tmpColor.set(cssCol);
        colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      fluidGeo.computeVertexNormals();

      // 2. Advect Hydrodynamic Stream Particles across the Displacement Field
      for (let i = 0; i < fluidParticles.length; i++) {
        const fp = fluidParticles[i];
        if (fp.isBuyer) {
          fp.x += dt * fp.speed * (0.8 + curOfi.overallBuySellRatio * 0.35);
          if (fp.x > shockX + 0.6) {
            fp.x = -meshWidth * 0.48;
          }
        } else {
          fp.x -= dt * fp.speed * (1.2 / Math.max(0.4, curOfi.overallBuySellRatio));
          if (fp.x < shockX - 0.6) {
            fp.x = meshWidth * 0.48;
          }
        }

        const waveHeight = fp.isBuyer
          ? 0.6 + Math.sin(fp.x * 0.5 - elapsed * 2.5) * 0.75 * buyAmp
          : -0.6 - Math.cos(fp.x * 0.5 + elapsed * 2.5) * 0.75 * sellAmp;
        fp.mesh.position.set(fp.x, waveHeight, fp.z);
      }

      // 3. Smooth Camera Damping
      if (targetCamRef.current.active) {
        const lambda = 5.5;
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          targetCamRef.current.pos.x,
          lambda,
          dt
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          targetCamRef.current.pos.y,
          lambda,
          dt
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          targetCamRef.current.pos.z,
          lambda,
          dt
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          targetCamRef.current.lookAt.x,
          lambda,
          dt
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          targetCamRef.current.lookAt.y,
          lambda,
          dt
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          targetCamRef.current.lookAt.z,
          lambda,
          dt
        );
        if (camera.position.distanceTo(targetCamRef.current.pos) < 0.08) {
          targetCamRef.current.active = false;
        }
      }

      controls.update();

      if (bokehPass && composer) {
        const uniforms = bokehPass.uniforms as Record<string, { value: number }>;
        if (uniforms['focus']) {
          uniforms['focus'].value = latestRef.current.dofFocus;
        }
        if (uniforms['aperture']) {
          uniforms['aperture'].value = latestRef.current.dofEnabled
            ? latestRef.current.dofAperture * 0.0001
            : 0;
        }
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      isDisposed = true;
      io?.disconnect();
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-full min-h-[460px] bg-[#060911] overflow-hidden select-none border border-slate-800/80 rounded-lg">
      {/* Isolated WebGL Mount Container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Glass-Morphism Telemetry Header */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1 bg-[#090D16]/85 backdrop-blur-md border border-slate-800 px-3.5 py-2.5 rounded-lg max-w-xl">
        <div className="flex items-center gap-2 text-xs font-bold text-white font-display">
          <Waves className="w-4 h-4 text-cyan-400" />
          <span>
            3D Delta Flow Mapping // D3 + Three.js Pressure-Sensitive Fluid Displacement Mesh
          </span>
        </div>
        <div className="text-[11px] text-slate-300 font-mono tabular-nums">
          Buyer Pressure (λ_buy):{' '}
          <strong className="text-cyan-300">
            {quant.hawkesBuyIntensity.toFixed(1)}k Ψ
          </strong>{' '}
          vs Seller Pressure (λ_sell):{' '}
          <strong className="text-rose-400">
            {quant.hawkesSellIntensity.toFixed(1)}k Ψ
          </strong>{' '}
          · Net OFI:{' '}
          <strong
            className={
              ofiSummary.overallOfiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }
          >
            {ofiSummary.overallOfiPct >= 0 ? '+' : ''}
            {ofiSummary.overallOfiPct}% ({ofiSummary.overallBuySellRatio}x B/S)
          </strong>
        </div>
        <div className="text-[10px] text-slate-400">
          Cyan/Emerald crests = Aggressive Market Buy pressure wave · Crimson troughs = Market Sell cavitation · Gold ribbon = Zero-Delta Shockfront
        </div>
      </div>

      {/* Top-Right Action Buttons */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {onTriggerFluidSignal && (
          <button
            type="button"
            onClick={() => {
              const isBull = ofiSummary.overallBuySellRatio >= 1.0;
              onTriggerFluidSignal(
                isBull ? 'LONG' : 'SHORT',
                isBull
                  ? `HYPERLIQUID 3D DELTA FLUID LONG // BUY PRESSURE WAVE ${ofiSummary.overallBuySellRatio}x`
                  : `HYPERLIQUID 3D DELTA FLUID SHORT // SELL SHOCKWAVE ${ofiSummary.overallBuySellRatio}x`,
                `3D Delta Flow Fluid Field detected net ${
                  isBull ? 'Buyer' : 'Seller'
                } hydrodynamic pressure dominance (OFI ${
                  ofiSummary.overallOfiPct
                }%, Hawkes λ=${quant.hawkesBranchingRatio.toFixed(2)}).`
              );
            }}
            className="px-2.5 py-1.5 text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Delta Shock Signal</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => applyPreset('collision')}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Reset Field</span>
        </button>

        {onToggleExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Split View</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Full 3D Stage</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Raycasted Hover Tooltip */}
      {hoveredCell && (
        <div className="absolute top-24 left-3 z-10 pointer-events-none bg-[#090D16]/95 border border-slate-700 px-3.5 py-2.5 rounded-md shadow-2xl max-w-xs font-mono text-xs">
          <div className="font-sans font-semibold text-white flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-xs"
              style={{ backgroundColor: hoveredCell.accentColor }}
            />
            <span>{hoveredCell.title}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {hoveredCell.subtitle}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <span className="text-slate-500 block">Mkt Buy</span>
              <span className="text-cyan-300 font-semibold">
                {hoveredCell.buyPressurePsi}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Mkt Sell</span>
              <span className="text-rose-400 font-semibold">
                {hoveredCell.sellPressurePsi}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Net Delta</span>
              <span className="text-amber-300 font-semibold">
                {hoveredCell.netDeltaUsd}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 transition-transform duration-200"
        style={{
          maxWidth: 'min(940px, 95%)',
          width: '100%',
          transform: dockCollapsed
            ? 'translate(-50%, calc(100% - 28px))'
            : 'translate(-50%, 0)',
        }}
      >
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="px-3 py-1 text-[11px] font-medium text-slate-300 bg-[#0B101B] hover:bg-slate-800 border border-b-0 border-slate-800 rounded-t-md flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Show 3D Delta Fluid Controls</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                <span>Hide Controls</span>
              </>
            )}
          </button>
        </div>

        <div className="bg-[#0B101B]/95 backdrop-blur-md border border-slate-800 rounded-lg px-3.5 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3">
          {/* Camera Presets */}
          <div className="flex items-center gap-1 bg-[#070A12] p-1 rounded-md border border-slate-800/80">
            <Camera className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 shrink-0" />
            {(
              [
                { id: 'collision', label: 'Fluid Collision Iso' },
                { id: 'buywave', label: 'Buyer Wavefront' },
                { id: 'sellwave', label: 'Seller Shockwave' },
                { id: 'topmap', label: 'Top-Down Pressure' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyPreset(item.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  preset === item.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Fluid Displacement & Bokeh DOF Controls */}
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Pressure Gain:</span>
              <input
                type="range"
                min={0.5}
                max={2.4}
                step={0.05}
                value={pressureGain}
                onChange={(e) => setPressureGain(Number(e.target.value))}
                className="w-16 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-cyan-300 w-9">
                {pressureGain.toFixed(2)}x
              </span>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <span className="text-slate-400">Viscosity (μ):</span>
              <input
                type="range"
                min={0.1}
                max={1.0}
                step={0.05}
                value={viscosityDamping}
                onChange={(e) => setViscosityDamping(Number(e.target.value))}
                className="w-14 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-amber-300 w-8">
                {viscosityDamping.toFixed(2)}
              </span>
            </label>

            <button
              type="button"
              onClick={() => setDofEnabled((v) => !v)}
              className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                dofEnabled
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              <Focus className="w-3.5 h-3.5" />
              <span>DOF: {dofEnabled ? 'ON' : 'OFF'}</span>
            </button>

            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <span className="text-slate-400">Focus:</span>
              <input
                type="range"
                min={10}
                max={40}
                step={1}
                value={dofFocus}
                onChange={(e) => setDofFocus(Number(e.target.value))}
                className="w-14 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-cyan-300 w-7">{dofFocus}m</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
