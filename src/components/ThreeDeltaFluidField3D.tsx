import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import * as d3 from 'd3';
import { ClipboardList, Focus, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import {
  AggrTradeTick,
  OFIMomentumSummary,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { GLOW, T3, T3_CSS, isNarrowViewport, labFov, labPixelRatio } from '../views/lab/tokens3d';
import { DockPresets, DockSlider, DockToggle, HoverCard, HudButton, HudHeader, SCENE_FRAME, SceneDock } from '../views/lab/hud';
import { tr } from '../i18n';
import { fmtFixed, fmtNum, fmtPrice } from '../ui/format';

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

// Zwalnia materiał wraz ze wszystkimi teksturami, do których się odwołuje (map, envMap, normalMap itd.).
// Zbiór `disposed` chroni przed wielokrotnym dispose materiałów współdzielonych przez wiele meshy.
const disposeMaterialDeep = (
  material: THREE.Material,
  disposed: Set<THREE.Material>
) => {
  if (disposed.has(material)) return;
  disposed.add(material);
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
};

// Przechodzi po całym grafie sceny i zwalnia geometrie, materiały (także tablice materiałów),
// ich tekstury oraz mapy cieni świateł.
const disposeSceneGraph = (
  root: THREE.Object3D,
  disposedMaterials: Set<THREE.Material>
) => {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((m) => disposeMaterialDeep(m, disposedMaterials));
    }
    const light = obj as THREE.DirectionalLight;
    if (light.isLight && light.shadow) light.shadow.dispose();
  });
};

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
  // Głębia ostrości domyślnie wyłączona — czytelność danych ważniejsza od efektu
  const [dofEnabled, setDofEnabled] = useState<boolean>(false);
  const [dofFocus, setDofFocus] = useState<number>(22);
  const [dofAperture] = useState<number>(2.0);
  const [pressureGain, setPressureGain] = useState<number>(1.35);
  const [viscosityDamping, setViscosityDamping] = useState<number>(0.45);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(isNarrowViewport);
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

  // Flaga "dane zmienione": filary ciśnienia są przebudowywane tylko gdy zmieniły się dane,
  // z których powstają (OFI, quant, cena, gain) — nie przy każdym ticku timera
  const dirtyRef = useRef<boolean>(true);

  useEffect(() => {
    dirtyRef.current = true;
  }, [ofiSummary, quant, currentPrice, pressureGain]);

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
    renderer.toneMappingExposure = 1.0;
    renderer.setPixelRatio(labPixelRatio(isSoftwareGl));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(T3.bg);
    scene.fog = new THREE.FogExp2(T3.bg, 0.014);

    // 2. Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmrem = new THREE.PMREMGenerator(renderer);
    // Trzymamy render target PMREM, aby zwolnić mapę środowiskową przy odmontowaniu;
    // RoomEnvironment (geometrie + materiały) jest potrzebny tylko do wygenerowania mapy
    const roomEnvironment = new RoomEnvironment();
    const envRenderTarget = pmrem.fromScene(roomEnvironment, 0.04);
    scene.environment = envRenderTarget.texture;
    pmrem.dispose();
    roomEnvironment.dispose();

    const camera = new THREE.PerspectiveCamera(labFov(width / height), width / height, 0.5, 160);
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
    const hemiLight = new THREE.HemisphereLight(0xc8d4e3, T3.bg, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    keyLight.position.set(16, 28, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const buyRimLight = new THREE.PointLight(T3.buy, 1.5, 32);
    buyRimLight.position.set(-12, 6, 0);
    scene.add(buyRimLight);

    const sellRimLight = new THREE.PointLight(T3.sell, 1.5, 32);
    sellRimLight.position.set(12, 6, 0);
    scene.add(sellRimLight);

    // 4. Skala rozbieżna: dwa bieguny (sprzedaż / kupno) + szary środek (styleguide §dataviz)
    // Znormalizowana presja: −1 (przewaga sprzedających) .. 0 (równowaga) .. +1 (przewaga kupujących)
    const d3PressureColor = d3
      .scaleSequential<string>((t) =>
        d3.interpolateRgbBasis([
          '#f07c55', // sell-ink — skrajna presja sprzedaży
          '#d9582e', // sell
          '#3a4658', // neutralny środek
          '#19a88e', // buy
          '#35c9a8', // buy-ink — skrajna presja kupna
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
      color: T3.ink3,
      wireframe: true,
      transparent: true,
      opacity: 0.1,
    });
    const wireMesh = new THREE.Mesh(fluidGeo, wireMat);
    wireMesh.position.y = 0.015;
    scene.add(wireMesh);

    // Ground Reference Grid Pedestal
    const gridHelper = new THREE.GridHelper(28, 28, T3.lineStrong, T3.line);
    gridHelper.position.y = -3.4;
    scene.add(gridHelper);

    // 6. Dynamic Collision Shockwave Boundary & Hydrodynamic Advection Stream Particles
    const shockLineGroup = new THREE.Group();
    const pressurePillarsGroup = new THREE.Group();
    scene.add(shockLineGroup, pressurePillarsGroup);

    // 16 znaczników kierunku (8 kupna → w prawo, 8 sprzedaży → w lewo); tempo zależy od stosunku kupno/sprzedaż
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
    for (let i = 0; i < 16; i++) {
      const isBuyer = i < 8;
      const partMat = new THREE.MeshStandardMaterial({
        color: isBuyer ? T3.buy : T3.sell,
        emissive: isBuyer ? T3.buy : T3.sell,
        emissiveIntensity: GLOW * 2,
        roughness: 0.35,
        metalness: 0.3,
      });
      const partMesh = new THREE.Mesh(partGeo, partMat);
      streamParticlesGroup.add(partMesh);

      fluidParticles.push({
        mesh: partMesh,
        isBuyer,
        x: isBuyer
          ? -meshWidth * 0.48 + (i % 8) * 1.5
          : meshWidth * 0.48 - (i % 8) * 1.5,
        z: ((i % 4) - 1.5) * 3.6,
        speed: 2.2 + (i % 5) * 0.45,
      });
    }

    // Materiał wstęgi shockfrontu tworzony raz i współdzielony między przebudowami
    // (wstęga odświeża się co 0.45 s) — zwalniany dopiero przy odmontowaniu
    const shockTubeMat = new THREE.MeshStandardMaterial({
      color: T3.ink1,
      emissive: T3.ink1,
      emissiveIntensity: GLOW,
      roughness: 0.4,
      metalness: 0.3,
    });
    const sharedMaterials = new Set<THREE.Material>([shockTubeMat]);
    // Materiały per-rebuild usunięte ze sceny — zwalniane dopiero po kolejnym renderze,
    // gdy nowe materiały trzymają już referencję do tych samych programów shaderów
    // (natychmiastowy dispose usunąłby program i wymusił ponowną kompilację)
    const pendingMaterialDisposal: THREE.Material[] = [];

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const c = grp.children[0] as THREE.Mesh;
        if (c.geometry) c.geometry.dispose();
        // Materiały per-rebuild → kolejka odroczonego dispose; współdzielone (cache) zostają
        if (c.material) {
          const materials = Array.isArray(c.material) ? c.material : [c.material];
          materials.forEach((m) => {
            if (!sharedMaterials.has(m)) pendingMaterialDisposal.push(m);
          });
        }
        grp.remove(c);
      }
    };

    // Rebuild Discrete Price-Tick Pressure Pillars & Collision Shock Ribbon
    let lastOverlayRebuild = 0;
    const rebuildPressurePillarsAndShockLine = (
      elapsed: number,
      rebuildPillars = true
    ) => {
      const {
        ofiSummary: curOfi,
        quant: curQuant,
        currentPrice: curPx,
        pressureGain: curGain,
      } = latestRef.current;

      clearGroup(shockLineGroup);
      if (rebuildPillars) clearGroup(pressurePillarsGroup);

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
      const shockTubeMesh = new THREE.Mesh(shockTubeGeo, shockTubeMat);
      shockTubeMesh.layers.enable(1);
      shockTubeMesh.userData = {
        title: tr(`Linia styku · cena ${fmtFixed(curPx, 1)}`, `Contact line · price ${fmtFixed(curPx, 1)}`),
        subtitle: tr(
          `Przewaga netto (Hawkes) ${fmtFixed(curQuant.hawkesNetDominance * 100, 1)}% · kupno/sprzedaż ${fmtNum(curOfi.overallBuySellRatio)}×`,
          `Net edge (Hawkes) ${fmtFixed(curQuant.hawkesNetDominance * 100, 1)}% · buy/sell ${fmtNum(curOfi.overallBuySellRatio)}×`
        ),
        buyPressurePsi: `λ ${fmtFixed(curQuant.hawkesBuyIntensity, 2)}`,
        sellPressurePsi: `λ ${fmtFixed(curQuant.hawkesSellIntensity, 2)}`,
        netDeltaUsd: `OFI ${curOfi.overallOfiPct >= 0 ? '+' : ''}${fmtNum(curOfi.overallOfiPct)}%`,
        accentColor: T3_CSS.ink2,
      };
      shockLineGroup.add(shockTubeMesh);

      // Filary ciśnienia zależą wyłącznie od danych — budowane tylko gdy dane się zmieniły
      if (!rebuildPillars) return;

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
        // Wyczerpanie przepływu = jasny słupek (ink-1); poza tym strona OFI (kupno/sprzedaż)
        const colHex =
          t.exhaustionState !== 'NONE'
            ? T3.ink1
            : t.ofiNormalized >= 0
            ? T3.buy
            : T3.sell;
        const nodeMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: GLOW,
          roughness: 0.4,
          metalness: 0.35,
        });
        const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
        nodeMesh.position.set(x, -3.2 + h * 0.5, z);
        nodeMesh.layers.enable(1);
        nodeMesh.userData = {
          title: `${tr('Poziom', 'Level')} ${fmtPrice(t.price, 1)} (${t.side}) ${t.ofiNormalized >= 0 ? '▲' : '▼'}`,
          subtitle: tr(`Kupno/sprzedaż ${fmtFixed(t.buySellRatio, 2)}× · wyczerpanie ${t.exhaustionScore}%`, `Buy/sell ${fmtFixed(t.buySellRatio, 2)}× · exhaustion ${t.exhaustionScore}%`),
          buyPressurePsi: `$${fmtFixed(t.aggressiveBuyUsd / 1000, 0)}K`,
          sellPressurePsi: `$${fmtFixed(t.aggressiveSellUsd / 1000, 0)}K`,
          netDeltaUsd: `${t.deltaUsd >= 0 ? '+' : '−'}$${fmtFixed(Math.abs(t.deltaUsd) / 1000, 0)}K`,
          accentColor:
            t.exhaustionState !== 'NONE'
              ? '#eef2f7'
              : t.ofiNormalized >= 0
              ? T3_CSS.buy
              : T3_CSS.sell,
        };
        pressurePillarsGroup.add(nodeMesh);
      });
    };

    rebuildPressurePillarsAndShockLine(0);
    // Filary zbudowane z bieżących danych — kolejna przebudowa dopiero po zmianie propsów
    dirtyRef.current = false;

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
      camera.fov = labFov(w / h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Pre-allocated Color object for zero GC inside render loop
    const _tmpColor = new THREE.Color();

    // LUT kolorów ciśnienia (256 wpisów RGB) budowana raz z tego samego interpolatora D3 —
    // zastępuje konwersję D3 → string CSS → THREE.Color dla każdego wierzchołka w każdej klatce
    const PRESSURE_LUT_SIZE = 256;
    const pressureColorLut = new Float32Array(PRESSURE_LUT_SIZE * 3);
    for (let k = 0; k < PRESSURE_LUT_SIZE; k++) {
      _tmpColor.set(d3PressureColor(-1 + (2 * k) / (PRESSURE_LUT_SIZE - 1)));
      pressureColorLut[k * 3] = _tmpColor.r;
      pressureColorLut[k * 3 + 1] = _tmpColor.g;
      pressureColorLut[k * 3 + 2] = _tmpColor.b;
    }
    // Licznik klatek do rzadszego przeliczania normalnych powierzchni
    let normalsFrameCounter = 0;

    const startTimeMs = performance.now();
    let prevTimeMs = startTimeMs;
    // Osobne identyfikatory dla requestAnimationFrame i setTimeout — każdy anulowany właściwą funkcją
    let rafId = 0;
    let timeoutId = 0;
    let isDisposed = false;
    let isVisible = true;
    // Karta w tle: pętla renderu stoi całkowicie (bez timerów), wznowienie po powrocie
    let pausedHidden = false;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' && pausedHidden && !isDisposed) {
        pausedHidden = false;
        prevTimeMs = performance.now();
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

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
        timeoutId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          timeoutId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timeoutId = window.setTimeout(cb, 80);
        }
      };
      timeoutId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isDisposed) return;
      if (document.visibilityState === 'hidden') {
        pausedHidden = true;
        return;
      }
      const nowMs = performance.now();
      const dt = Math.min(0.1, (nowMs - prevTimeMs) / 1000);
      prevTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (!isVisible) {
        timeoutId = window.setTimeout(tick, 250);
        return;
      }

      if (elapsed - lastOverlayRebuild > 0.45) {
        lastOverlayRebuild = elapsed;
        // Wstęga shockfrontu jest animowana w czasie (elapsed), więc nadal odświeża się co 0.45 s;
        // filary ciśnienia przebudowywane tylko gdy dane się zmieniły (dirtyRef)
        const pillarsDirty = dirtyRef.current;
        dirtyRef.current = false;
        rebuildPressurePillarsAndShockLine(elapsed, pillarsDirty);
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
        // Kolor z prekomputowanej LUT: [-1, 1] → indeks 0..255 (NaN → 0, bez wyjścia poza tablicę)
        const lutT = (netPressureNorm + 1) * 0.5;
        const lutIdx =
          (lutT > 0 ? (lutT < 1 ? Math.round(lutT * 255) : 255) : 0) * 3;
        colAttr.setXYZ(
          i,
          pressureColorLut[lutIdx],
          pressureColorLut[lutIdx + 1],
          pressureColorLut[lutIdx + 2]
        );
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      // Wysokości animują się co klatkę, ale normalne liczymy co 3. klatkę —
      // computeVertexNormals() jest kosztowne, a różnica oświetlenia jest niezauważalna
      if (normalsFrameCounter % 3 === 0) {
        fluidGeo.computeVertexNormals();
      }
      normalsFrameCounter++;

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

      // Głębia ostrości tylko gdy włączona — inaczej render bez post-processingu (taniej)
      if (bokehPass && composer && latestRef.current.dofEnabled) {
        const uniforms = bokehPass.uniforms as Record<string, { value: number }>;
        if (uniforms['focus']) {
          uniforms['focus'].value = latestRef.current.dofFocus;
        }
        if (uniforms['aperture']) {
          uniforms['aperture'].value = latestRef.current.dofAperture * 0.0001;
        }
        composer.render();
      } else {
        renderer.render(scene, camera);
      }

      // Odroczone zwolnienie materiałów z poprzedniej przebudowy (po renderze nowej sceny)
      if (pendingMaterialDisposal.length > 0) {
        pendingMaterialDisposal.forEach((m) => m.dispose());
        pendingMaterialDisposal.length = 0;
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      isDisposed = true;
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();

      // Post-processing: EffectComposer.dispose() nie zwalnia dodanych passów (BokehPass, RenderPass)
      if (composer) {
        composer.passes.forEach((pass) => pass.dispose());
        composer.dispose();
      }

      // Geometrie, materiały i tekstury całej sceny + materiały współdzielone
      // + materiały czekające na odroczony dispose
      const disposedMaterials = new Set<THREE.Material>();
      disposeSceneGraph(scene, disposedMaterials);
      sharedMaterials.forEach((m) => disposeMaterialDeep(m, disposedMaterials));
      pendingMaterialDisposal.forEach((m) =>
        disposeMaterialDeep(m, disposedMaterials)
      );
      pendingMaterialDisposal.length = 0;

      // Mapa środowiskowa PMREM
      scene.environment = null;
      envRenderTarget.dispose();

      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, []);

  const fluidIsBull = ofiSummary.overallBuySellRatio >= 1.0;

  return (
    <div className={SCENE_FRAME}>
      {/* Kontener WebGL */}
      <div ref={canvasMountRef} className="w-full h-full" />

      <HudHeader title={tr('Delta Fluid · presja agresywnych kupujących vs sprzedających', 'Delta Fluid · pressure of aggressive buyers vs sellers')}>
        λ {tr('kupno', 'buy')} <span className="text-buy-ink">▲ {fmtFixed(quant.hawkesBuyIntensity, 2)}</span> · λ {tr('sprzedaż', 'sell')}{' '}
        <span className="text-sell-ink">▼ {fmtFixed(quant.hawkesSellIntensity, 2)}</span> · OFI {ofiSummary.overallOfiPct >= 0 ? '+' : ''}
        {fmtNum(ofiSummary.overallOfiPct)}% ({fmtNum(ofiSummary.overallBuySellRatio)}× {tr('K/S', 'B/S')})
        <span className="block text-ink-3 font-sans">
          {tr('Lewo: kupno · prawo: sprzedaż · jasna linia: styk stron. Fale są efektem wizualnym.', 'Left: buy · right: sell · bright line: where the sides meet. The waves are a visual effect.')}
        </span>
      </HudHeader>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {onTriggerFluidSignal && (
          <HudButton
            emphasis
            onClick={() =>
              onTriggerFluidSignal(
                fluidIsBull ? 'LONG' : 'SHORT',
                tr(`Delta Fluid: przewaga ${fluidIsBull ? 'kupujących' : 'sprzedających'}`, `Delta Fluid: ${fluidIsBull ? 'buyers' : 'sellers'} dominate`),
                `${tr('Kupno/sprzedaż', 'Buy/sell')} ${fmtNum(ofiSummary.overallBuySellRatio)}× · OFI ${fmtNum(ofiSummary.overallOfiPct)}% · ${tr('η Hawkesa', 'Hawkes η')} ${
                  // null = współczynnik rozgałęzienia nieestymowany → "n/a"
                  quant.hawkesBranchingRatio !== null ? fmtFixed(quant.hawkesBranchingRatio, 2) : 'n/a'
                }`
              )
            }
            icon={<ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />}
            label={`${tr('Przekaż do planu', 'Send to plan')} · ${fluidIsBull ? '▲ Long' : '▼ Short'}`}
            title={tr('Przekazuje kierunek przewagi przepływu do Analizatora planu — plan ocenisz tam', 'Sends the direction of the flow edge to the Plan Analyzer, where you evaluate the plan')}
          />
        )}
        <HudButton onClick={() => applyPreset('collision')} icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />} label={tr('Reset kamery', 'Reset camera')} />
        {onToggleExpand && (
          <HudButton
            onClick={onToggleExpand}
            icon={isExpanded ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
            label={isExpanded ? tr('Widok dzielony', 'Split view') : tr('Pełny ekran', 'Full screen')}
          />
        )}
      </div>

      {hoveredCell && (
        <HoverCard
          swatch={hoveredCell.accentColor}
          title={hoveredCell.title}
          subtitle={hoveredCell.subtitle}
          rows={[
            { k: tr('Kupno ▲', 'Buy ▲'), v: hoveredCell.buyPressurePsi },
            { k: tr('Sprzedaż ▼', 'Sell ▼'), v: hoveredCell.sellPressurePsi },
            { k: tr('Netto', 'Net'), v: hoveredCell.netDeltaUsd },
          ]}
        />
      )}

      <SceneDock collapsed={dockCollapsed} onToggle={() => setDockCollapsed((v) => !v)}>
        <DockPresets<FluidCameraPreset>
          ariaLabel={tr('Kamera', 'Camera')}
          value={preset}
          onChange={applyPreset}
          options={[
            { id: 'collision', label: tr('Izometria', 'Isometric') },
            { id: 'buywave', label: tr('Strona kupna', 'Buy side') },
            { id: 'sellwave', label: tr('Strona sprzedaży', 'Sell side') },
            { id: 'topmap', label: tr('Z góry', 'Top-down') },
          ]}
        />
        <DockSlider label={tr('Wzmocnienie (wizualne)', 'Gain (visual)')} min={0.5} max={2.4} step={0.05} value={pressureGain} onChange={setPressureGain} format={(v) => `${fmtFixed(v, 2)}×`} />
        <DockSlider label={tr('Tłumienie (wizualne)', 'Damping (visual)')} min={0.1} max={1} step={0.05} value={viscosityDamping} onChange={setViscosityDamping} format={(v) => fmtFixed(v, 2)} />
        <DockToggle on={dofEnabled} onClick={() => setDofEnabled((v) => !v)}>
          <Focus className="w-3 h-3" aria-hidden="true" /> {tr('Głębia ostrości', 'Depth of field')}
        </DockToggle>
        {dofEnabled && <DockSlider label={tr('Ostrość', 'Focus')} min={10} max={40} step={1} value={dofFocus} onChange={setDofFocus} format={(v) => `${v} m`} />}
      </SceneDock>
    </div>
  );
};
