import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Eye, Focus, Layers, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import {
  L2OrderbookLevel,
  LiquidationHeatmapCell,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { candlesLabel } from '../views/micro/horizon';
import { GLOW, T3, T3_CSS, isNarrowViewport, labFov, labPixelRatio } from '../views/lab/tokens3d';
import { DockPresets, DockSlider, DockToggle, HoverCard, HudButton, HudHeader, SCENE_FRAME, SceneDock } from '../views/lab/hud';

interface ThreeQuantViewportProps {
  bars: OHLCVBar[];
  shaakuni: ShaakuniState;
  heatmap: LiquidationHeatmapCell[];
  quant: QuantMathMetrics;
  bids: L2OrderbookLevel[];
  asks: L2OrderbookLevel[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

type CameraPreset = 'isometric' | 'canyon' | 'trajectory' | 'topdown';

interface HoveredTensorNode {
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
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

export const ThreeQuantViewport: React.FC<ThreeQuantViewportProps> = ({
  bars,
  shaakuni,
  heatmap,
  quant,
  bids,
  asks,
  isExpanded = false,
  onToggleExpand,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  // Interactive 3D & Depth of Field (DOF) state controlled via Collapsible Bottom Dock
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('isometric');
  // Głębia ostrości domyślnie wyłączona — czytelność danych ważniejsza od efektu
  const [dofEnabled, setDofEnabled] = useState<boolean>(false);
  const [dofFocus, setDofFocus] = useState<number>(26);
  const [dofAperture, setDofAperture] = useState<number>(1.8); // x 0.0001
  const [explodedScale, setExplodedScale] = useState<number>(1.0);
  const [showOBVolumes, setShowOBVolumes] = useState<boolean>(true);
  const [showNeuralSurface, setShowNeuralSurface] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(isNarrowViewport);
  const [hoveredNode, setHoveredNode] = useState<HoveredTensorNode | null>(null);

  // Store latest props & controls in refs so React updates never tear down the WebGL canvas
  const latestDataRef = useRef({
    bars,
    shaakuni,
    heatmap,
    quant,
    bids,
    asks,
    dofEnabled,
    dofFocus,
    dofAperture,
    explodedScale,
    showOBVolumes,
    showNeuralSurface,
  });

  useEffect(() => {
    latestDataRef.current = {
      bars,
      shaakuni,
      heatmap,
      quant,
      bids,
      asks,
      dofEnabled,
      dofFocus,
      dofAperture,
      explodedScale,
      showOBVolumes,
      showNeuralSurface,
    };
  }, [
    bars,
    shaakuni,
    heatmap,
    quant,
    bids,
    asks,
    dofEnabled,
    dofFocus,
    dofAperture,
    explodedScale,
    showOBVolumes,
    showNeuralSurface,
  ]);

  // Flaga "dane zmienione": scena 3D jest przebudowywana tylko gdy zmieniły się dane
  // lub opcje wpływające na geometrię (suwaki DOF działają przez uniformy, bez przebudowy)
  const dirtyRef = useRef<boolean>(true);

  useEffect(() => {
    dirtyRef.current = true;
  }, [
    bars,
    shaakuni,
    heatmap,
    quant,
    bids,
    asks,
    explodedScale,
    showOBVolumes,
    showNeuralSurface,
  ]);

  const targetCamRef = useRef<{
    pos: THREE.Vector3;
    lookAt: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(20, 15, 24),
    lookAt: new THREE.Vector3(0, 1, 0),
    active: false,
  });

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    if (preset === 'isometric') {
      targetCamRef.current = {
        pos: new THREE.Vector3(20, 14, 24),
        lookAt: new THREE.Vector3(1, 0.5, 0),
        active: true,
      };
    } else if (preset === 'canyon') {
      targetCamRef.current = {
        pos: new THREE.Vector3(14, 5.5, 2.5),
        lookAt: new THREE.Vector3(-2, 0.5, 0),
        active: true,
      };
    } else if (preset === 'trajectory') {
      targetCamRef.current = {
        pos: new THREE.Vector3(8, 10, 22),
        lookAt: new THREE.Vector3(7, 0.5, 0),
        active: true,
      };
    } else if (preset === 'topdown') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 30, 4),
        lookAt: new THREE.Vector3(0, 0, 0),
        active: true,
      };
    }
  };

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software WebGL Detection (SwiftShader, llvmpipe, WARP) per Three.js skill
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = Math.max(300, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

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
    scene.fog = new THREE.FogExp2(T3.bg, 0.015);

    // 2. Mandatory Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    // Trzymamy render target PMREM, aby zwolnić mapę środowiskową przy odmontowaniu;
    // RoomEnvironment (geometrie + materiały) jest potrzebny tylko do wygenerowania mapy
    const roomEnvironment = new RoomEnvironment();
    const envRenderTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
    scene.environment = envRenderTarget.texture;
    pmremGenerator.dispose();
    roomEnvironment.dispose();

    const camera = new THREE.PerspectiveCamera(labFov(width / height), width / height, 0.5, 160);
    camera.position.set(20, 14, 24);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 65;
    controls.target.set(1, 0.5, 0);

    controls.addEventListener('start', () => {
      targetCamRef.current.active = false;
    });

    // 3. Three-Point Studio Lighting (Warm Key, Cool Hemisphere Fill, Cyan Rim)
    const hemiLight = new THREE.HemisphereLight(0xc8d4e3, T3.bg, 0.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    keyLight.position.set(16, 28, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -22;
    keyLight.shadow.camera.right = 22;
    keyLight.shadow.camera.top = 22;
    keyLight.shadow.camera.bottom = -22;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(T3.accent, 0.8);
    rimLight.position.set(-20, 14, -16);
    scene.add(rimLight);

    // 4. Grounding Platform & Procedural Precision Coordinate Grid
    const platformGroup = new THREE.Group();
    scene.add(platformGroup);

    const basePlateGeo = new THREE.BoxGeometry(36, 0.3, 22);
    const basePlateMat = new THREE.MeshStandardMaterial({
      color: T3.panel,
      roughness: 0.6,
      metalness: 0.4,
    });
    const basePlate = new THREE.Mesh(basePlateGeo, basePlateMat);
    basePlate.position.set(0, -4.2, 0);
    basePlate.receiveShadow = true;
    platformGroup.add(basePlate);

    const gridHelper = new THREE.GridHelper(34, 34, T3.lineStrong, T3.line);
    gridHelper.position.set(0, -4.02, 0);
    platformGroup.add(gridHelper);

    // 5. Hierarchical Composite 3D Subject Groups (3-12 distinct parts across scales)
    const rootMarketGroup = new THREE.Group();
    scene.add(rootMarketGroup);

    const candlesGroup = new THREE.Group();
    const orderBlocksGroup = new THREE.Group();
    const levelsGroup = new THREE.Group();
    const heatmapGroup = new THREE.Group();
    const l2CanyonGroup = new THREE.Group();
    const neuralSurfaceGroup = new THREE.Group();

    rootMarketGroup.add(
      candlesGroup,
      orderBlocksGroup,
      levelsGroup,
      heatmapGroup,
      l2CanyonGroup,
      neuralSurfaceGroup
    );

    // Interactive Raycasting Layer (Layer 1)
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2(-99, -99);
    let lastRaycastTime = 0;

    // Shared Materials (PBR with calibrated roughness & metalness variation >= 0.25)
    // Świece: kupno/sprzedaż w tokenach; drugi kanał = kierunek korpusu względem knota
    const bullCandleMat = new THREE.MeshStandardMaterial({
      color: T3.buy,
      emissive: T3.buy,
      emissiveIntensity: GLOW,
      roughness: 0.4,
      metalness: 0.35,
    });
    const bearCandleMat = new THREE.MeshStandardMaterial({
      color: T3.sell,
      emissive: T3.sell,
      emissiveIntensity: GLOW,
      roughness: 0.55,
      metalness: 0.3,
    });
    const wickMat = new THREE.MeshStandardMaterial({
      color: T3.ink3,
      roughness: 0.5,
      metalness: 0.4,
    });

    // Strefy OB w kolorze „zone”; strona (popyt/podaż) rozróżniona kolorem krawędzi i podpowiedzią
    const bullOBGlassMat = new THREE.MeshPhysicalMaterial({
      color: T3.zone,
      emissive: T3.zone,
      emissiveIntensity: 0.06,
      roughness: 0.15,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.82,
      transparent: true,
      opacity: isSoftwareGl ? 0.3 : 0.8,
      ior: 1.52,
      thickness: 1.2,
      depthWrite: false,
    });

    const bearOBGlassMat = new THREE.MeshPhysicalMaterial({
      color: T3.zone,
      emissive: T3.zone,
      emissiveIntensity: 0.06,
      roughness: 0.15,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.82,
      transparent: true,
      opacity: isSoftwareGl ? 0.3 : 0.8,
      ior: 1.52,
      thickness: 1.2,
      depthWrite: false,
    });

    // Ściany arkusza: BID bliżej (z = 3.2), ASK dalej (z = 4.2) — pozycja jako drugi kanał
    const bidWallMat = new THREE.MeshStandardMaterial({
      color: T3.buy,
      emissive: T3.buy,
      emissiveIntensity: GLOW,
      roughness: 0.45,
      metalness: 0.35,
    });

    const askWallMat = new THREE.MeshStandardMaterial({
      color: T3.sell,
      emissive: T3.sell,
      emissiveIntensity: GLOW,
      roughness: 0.45,
      metalness: 0.35,
    });

    // Materiały współdzielone między przebudowami sceny — clearGroup ich nie zwalnia,
    // są zwalniane dopiero przy odmontowaniu komponentu
    const sharedMaterials = new Set<THREE.Material>([
      bullCandleMat,
      bearCandleMat,
      wickMat,
      bullOBGlassMat,
      bearOBGlassMat,
      bidWallMat,
      askWallMat,
    ]);
    // Materiały tworzone per-rebuild, usunięte ze sceny — zwalniane dopiero po kolejnym renderze,
    // gdy nowe materiały trzymają już referencję do tych samych programów shaderów
    // (natychmiastowy dispose usunąłby program i wymusił ponowną kompilację przy każdej przebudowie)
    const pendingMaterialDisposal: THREE.Material[] = [];

    // Post-Processing Composer & BokehPass (Depth of Field)
    let composer: EffectComposer | null = null;
    let bokehPass: BokehPass | null = null;

    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      bokehPass = new BokehPass(scene, camera, {
        focus: latestDataRef.current.dofFocus,
        aperture: latestDataRef.current.dofAperture * 0.0001,
        maxblur: 0.008,
      });
      composer.addPass(bokehPass);
    }

    // Helper to clear a group's children cleanly
    const clearGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
        // Materiały per-rebuild → kolejka odroczonego dispose; współdzielone (cache) zostają
        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((m) => {
            if (!sharedMaterials.has(m)) pendingMaterialDisposal.push(m);
          });
        }
        group.remove(child);
      }
    };

    // Rebuild 3D Tensor Scene from live market state
    let lastSceneBuildTick = 0;
    const rebuildMarketScene = () => {
      const {
        bars: curBars,
        shaakuni: curShaakuni,
        heatmap: curHeatmap,
        quant: curQuant,
        bids: curBids,
        asks: curAsks,
        explodedScale: expScale,
        showOBVolumes: showOB,
        showNeuralSurface: showNeural,
      } = latestDataRef.current;

      if (curBars.length < 30) return;

      clearGroup(candlesGroup);
      clearGroup(orderBlocksGroup);
      clearGroup(levelsGroup);
      clearGroup(heatmapGroup);
      clearGroup(l2CanyonGroup);
      clearGroup(neuralSurfaceGroup);

      const sliceCount = 36;
      const visibleBars = curBars.slice(-sliceCount);
      const minP = Math.min(...visibleBars.map((b) => b.low));
      const maxP = Math.max(...visibleBars.map((b) => b.high));
      const midP = (minP + maxP) / 2;
      const priceSpan = Math.max(150, maxP - minP);

      const priceToY = (p: number) => ((p - midP) / priceSpan) * 7.5;

      // 1. Build 3D Composite Candlesticks (Body + Upper/Lower Wicks + Delta Pedestal)
      const startX = -12;
      const stepX = 0.52;

      const kalmanPoints: THREE.Vector3[] = [];

      visibleBars.forEach((b, idx) => {
        const x = startX + idx * stepX;
        const yOpen = priceToY(b.open);
        const yClose = priceToY(b.close);
        const yHigh = priceToY(b.high);
        const yLow = priceToY(b.low);

        const isBull = b.close >= b.open;
        const bodyHeight = Math.max(0.12, Math.abs(yClose - yOpen));
        const bodyY = (yOpen + yClose) / 2;

        // Primary Silhouette: Beveled/Cylindrical Candle Body
        const bodyGeo = new THREE.BoxGeometry(0.34, bodyHeight, 0.34);
        const bodyMesh = new THREE.Mesh(
          bodyGeo,
          isBull ? bullCandleMat : bearCandleMat
        );
        bodyMesh.position.set(x, bodyY, 0);
        bodyMesh.castShadow = true;
        bodyMesh.layers.enable(1);
        bodyMesh.userData = {
          title: `Świeca ${new Date(b.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} ${isBull ? '▲' : '▼'}`,
          subtitle: `O ${b.open.toFixed(1)} · H ${b.high.toFixed(1)} · L ${b.low.toFixed(1)} · C ${b.close.toFixed(1)}`,
          metricLabel: 'Delta (kupno − sprzedaż)',
          metricValue: `${b.vbuy - b.vsell >= 0 ? '+' : '−'}$${(Math.abs(b.vbuy - b.vsell) / 1000).toFixed(0)}K`,
          accentColor: isBull ? T3_CSS.buy : T3_CSS.sell,
        };
        candlesGroup.add(bodyMesh);

        // Secondary Read: Full Wick Spine
        const wickHeight = Math.max(0.18, yHigh - yLow);
        const wickGeo = new THREE.CylinderGeometry(0.04, 0.04, wickHeight, 6);
        const wickMesh = new THREE.Mesh(wickGeo, wickMat);
        wickMesh.position.set(x, (yHigh + yLow) / 2, 0);
        candlesGroup.add(wickMesh);

        // Accent Detail: CVD / Volume Delta Pillar on Z-flank
        const volRatio = Math.min(2.4, (b.vbuy + b.vsell) / 8000000);
        const volGeo = new THREE.BoxGeometry(0.28, Math.max(0.1, volRatio), 0.28);
        const volMesh = new THREE.Mesh(
          volGeo,
          isBull ? bullCandleMat : bearCandleMat
        );
        volMesh.position.set(x, -3.9 + volRatio / 2, 2.2 * expScale);
        candlesGroup.add(volMesh);

        kalmanPoints.push(new THREE.Vector3(x, priceToY(b.kalmanEstimate), 0.35));
      });

      // Kalman State-Space Trajectory Tube
      if (kalmanPoints.length > 2) {
        const curve = new THREE.CatmullRomCurve3(kalmanPoints);
        const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.06, 8, false);
        const tubeMat = new THREE.MeshStandardMaterial({
          color: T3.accent,
          emissive: T3.accent,
          emissiveIntensity: GLOW,
          roughness: 0.35,
          metalness: 0.4,
        });
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
        candlesGroup.add(tubeMesh);
      }

      // 2. Build 3D Volumetric Order Blocks (Shaakuni OB / POI Slabs with Frame Trim)
      if (showOB) {
        const totalBars = curBars.length;
        const freshOBs = curShaakuni.orderBlocks
          .filter((ob) => ob.state === 'fresh')
          .slice(-6);

        freshOBs.forEach((ob) => {
          const relStart = Math.max(
            0,
            sliceCount - (totalBars - ob.createdBarIndex)
          );
          const obStartX = startX + relStart * stepX;
          const obEndX = startX + (sliceCount + 4) * stepX;
          const obWidth = Math.max(1.5, obEndX - obStartX);

          const yTop = priceToY(ob.top);
          const yBot = priceToY(ob.bottom);
          const obHeight = Math.max(0.22, Math.abs(yTop - yBot));
          const obCenterY = (yTop + yBot) / 2;

          const obDepth = 3.6 * expScale;
          const obGeo = new THREE.BoxGeometry(obWidth, obHeight, obDepth);
          const obMesh = new THREE.Mesh(
            obGeo,
            ob.type === 'bull' ? bullOBGlassMat : bearOBGlassMat
          );
          obMesh.position.set(
            obStartX + obWidth / 2,
            obCenterY,
            -1.6 * expScale
          );
          obMesh.renderOrder = 5;
          obMesh.layers.enable(1);
          obMesh.userData = {
            title: `Strefa OB ${ob.type === 'bull' ? 'popytowa ▲' : 'podażowa ▼'} (${ob.label})`,
            subtitle: `Zakres ${ob.bottom.toFixed(1)} – ${ob.top.toFixed(1)}`,
            metricLabel: 'Impuls · stan',
            metricValue: `${ob.impulseAtrMultiple}× ATR · nietestowana`,
            accentColor: T3_CSS.zone,
          };
          orderBlocksGroup.add(obMesh);

          // Wireframe metallic trim around the Order Block
          const edgesGeo = new THREE.EdgesGeometry(obGeo);
          const edgesMat = new THREE.LineBasicMaterial({
            color: ob.type === 'bull' ? T3.buy : T3.sell,
          });
          const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
          edgesLine.position.copy(obMesh.position);
          orderBlocksGroup.add(edgesLine);
        });
      }

      // 3. Shaakuni Liquidity Levels (PDH, PDL, D-EQ, PWH, PWL, W-EQ Laser Beams)
      const keyLevels: {
        label: string;
        price: number | null;
        color: number;
        hex: string;
        status?: string;
      }[] = [
        {
          label: 'PDH (szczyt poprzedniego dnia)',
          price: curShaakuni.pdh,
          color: T3.level,
          hex: T3_CSS.level,
          status: curShaakuni.pdhStatus,
        },
        {
          label: 'PDL (dołek poprzedniego dnia)',
          price: curShaakuni.pdl,
          color: T3.level,
          hex: T3_CSS.level,
          status: curShaakuni.pdlStatus,
        },
        {
          label: 'D-EQ (50% dnia)',
          price: curShaakuni.deq,
          color: T3.ink2,
          hex: T3_CSS.ink2,
        },
        {
          label: 'W-EQ (50% tygodnia)',
          price: curShaakuni.weq,
          color: T3.ink3,
          hex: T3_CSS.ink3,
        },
      ];

      keyLevels.forEach((lvl) => {
        if (lvl.price === null) return;
        const y = priceToY(lvl.price);
        if (y < -4.2 || y > 5.5) return;

        const beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 24, 8);
        beamGeo.rotateZ(Math.PI / 2);
        const beamMat = new THREE.MeshStandardMaterial({
          color: lvl.color,
          emissive: lvl.color,
          emissiveIntensity: 0.2,
          roughness: 0.4,
          metalness: 0.3,
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.set(0, y, -0.5);
        beamMesh.layers.enable(1);
        beamMesh.userData = {
          title: lvl.label,
          subtitle: `Poziom ${lvl.price.toFixed(1)}`,
          metricLabel: 'Stan',
          metricValue: lvl.status ?? 'poziom równowagi',
          accentColor: lvl.hex,
        };
        levelsGroup.add(beamMesh);
      });

      // 4. Szacunek likwidacji z wolumenu (założone dźwignie 5×/20×/100×) — siła jako krycie, jeden odcień
      curHeatmap.slice(0, 14).forEach((cell) => {
        const y = priceToY(cell.priceLevel);
        if (y < -3.8 || y > 4.8) return;

        const lengthX = 0.8 + cell.intensityRatio * 3.8;
        const barGeo = new THREE.BoxGeometry(lengthX, 0.16, 0.42);
        const barMat = new THREE.MeshStandardMaterial({
          color: T3.zone,
          emissive: T3.zone,
          emissiveIntensity: GLOW,
          roughness: 0.45,
          metalness: 0.3,
          transparent: true,
          opacity: 0.35 + cell.intensityRatio * 0.6,
        });
        const barMesh = new THREE.Mesh(barGeo, barMat);
        barMesh.position.set(
          startX + sliceCount * stepX + 1.2 + lengthX / 2,
          y,
          -2.8 * expScale
        );
        barMesh.layers.enable(1);
        barMesh.userData = {
          title: `Szacunek likwidacji (założone ${cell.leverage}×)`,
          subtitle: `Zakres ${cell.bottom.toFixed(0)} – ${cell.top.toFixed(0)} · nie są to realne pozycje`,
          metricLabel: 'Siła szacunku',
          metricValue: `${(cell.intensityRatio * 100).toFixed(0)}% maks.`,
          accentColor: T3_CSS.zone,
        };
        heatmapGroup.add(barMesh);
      });

      // 5. Hyperliquid L2 Orderbook Depth Canyon (Right Flank)
      const canyonX = startX + sliceCount * stepX + 2.2;
      curBids.slice(0, 10).forEach((bid, idx) => {
        const h = Math.min(3.4, (bid.sizeUsd / 380000) * 1.4);
        const geo = new THREE.BoxGeometry(0.45, Math.max(0.15, h), 0.45);
        const mesh = new THREE.Mesh(geo, bidWallMat);
        mesh.position.set(canyonX + idx * 0.55, -3.9 + h / 2, 3.2 * expScale);
        mesh.castShadow = true;
        mesh.layers.enable(1);
        mesh.userData = {
          title: `Arkusz HL · BID ▲ (poziom ${idx + 1})`,
          subtitle: `Cena ${bid.price.toFixed(1)} · liczba zleceń na poziomie: ${bid.exchangeCount}`,
          metricLabel: 'Płynność',
          metricValue: `$${(bid.sizeUsd / 1000).toFixed(1)}K (${bid.sizeBtc} BTC)`,
          accentColor: T3_CSS.buy,
        };
        l2CanyonGroup.add(mesh);
      });

      curAsks.slice(0, 10).forEach((ask, idx) => {
        const h = Math.min(3.4, (ask.sizeUsd / 380000) * 1.4);
        const geo = new THREE.BoxGeometry(0.45, Math.max(0.15, h), 0.45);
        const mesh = new THREE.Mesh(geo, askWallMat);
        mesh.position.set(canyonX + idx * 0.55, -3.9 + h / 2, 4.2 * expScale);
        mesh.castShadow = true;
        mesh.layers.enable(1);
        mesh.userData = {
          title: `Arkusz HL · ASK ▼ (poziom ${idx + 1})`,
          subtitle: `Cena ${ask.price.toFixed(1)} · liczba zleceń na poziomie: ${ask.exchangeCount}`,
          metricLabel: 'Płynność',
          metricValue: `$${(ask.sizeUsd / 1000).toFixed(1)}K (${ask.sizeBtc} BTC)`,
          accentColor: T3_CSS.sell,
        };
        l2CanyonGroup.add(mesh);
      });

      // 5b. 3D Volume Profile (POC / VAH / VAL / Gravitational Liquidity Magnet Wall) on Left Flank
      if (curQuant.liquidityProfile && curQuant.liquidityProfile.length > 0) {
        const maxBucketVol = Math.max(
          1,
          ...curQuant.liquidityProfile.map((b) => b.totalVolumeUsd)
        );
        curQuant.liquidityProfile.forEach((bucket) => {
          const y = priceToY(bucket.price);
          if (y < -3.8 || y > 4.8) return;
          const lengthX = 0.5 + (bucket.totalVolumeUsd / maxBucketVol) * 3.4;
          const profGeo = new THREE.BoxGeometry(lengthX, 0.2, 0.35);
          // POC = akcent, Value Area = jaśniejszy ink, reszta = linia; bez neonów
          const colHex = bucket.isPOC ? T3.accent : bucket.isValueArea ? T3.ink3 : T3.lineStrong;
          const profMat = new THREE.MeshStandardMaterial({
            color: colHex,
            emissive: colHex,
            emissiveIntensity: bucket.isPOC ? 0.2 : 0.06,
            roughness: 0.45,
            metalness: 0.3,
          });
          const profMesh = new THREE.Mesh(profGeo, profMat);
          profMesh.position.set(
            startX - 1.2 - lengthX / 2,
            y,
            1.6 * expScale
          );
          profMesh.layers.enable(1);
          profMesh.userData = {
            title: bucket.isPOC ? `Profil wolumenu · POC (${bucket.price})` : `Profil wolumenu (${bucket.price})`,
            subtitle: `Wolumen $${(bucket.totalVolumeUsd / 1000000).toFixed(2)}M${bucket.isValueArea ? ' · Value Area' : ''}`,
            metricLabel: 'Przyciąganie U(p) (heurystyka)',
            metricValue: `${(bucket.gravityPotential * 100).toFixed(0)}%`,
            accentColor: bucket.isPOC ? T3_CSS.accent : T3_CSS.ink3,
          };
          l2CanyonGroup.add(profMesh);
        });
      }

      // 6. Trajektoria heurystyczna (Kalman + OU + ważona suma cech) z pasmem ±1σ
      if (showNeural && curQuant.forecastHorizon.length > 0) {
        const lastBar = visibleBars[visibleBars.length - 1];
        const anchorX = startX + (sliceCount - 1) * stepX;
        const anchorY = priceToY(lastBar.close);

        const pts: THREE.Vector3[] = [new THREE.Vector3(anchorX, anchorY, 0)];
        curQuant.forecastHorizon.forEach((fh, idx) => {
          const fx = anchorX + (idx + 1) * 1.65;
          const fy = priceToY(fh.predictedPrice);
          pts.push(new THREE.Vector3(fx, fy, 0));

          // Confidence Ring at each forecast horizon
          const sigmaSpan = Math.max(
            0.25,
            Math.abs(priceToY(fh.upper1Sigma) - priceToY(fh.lower1Sigma)) / 2
          );
          const ringGeo = new THREE.TorusGeometry(sigmaSpan, 0.04, 12, 32);
          ringGeo.rotateY(Math.PI / 2);
          const isBullForecast = fh.predictedPrice >= lastBar.close;
          const ringMat = new THREE.MeshStandardMaterial({
            color: isBullForecast ? T3.buy : T3.sell,
            emissive: isBullForecast ? T3.buy : T3.sell,
            emissiveIntensity: GLOW,
            roughness: 0.4,
            metalness: 0.3,
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.position.set(fx, fy, 0);
          ringMesh.layers.enable(1);
          ringMesh.userData = {
            title: `Trajektoria heurystyczna (${candlesLabel(fh.stepBars)}) ${isBullForecast ? '▲' : '▼'}`,
            subtitle: `Pasmo ±1σ: ${fh.lower1Sigma.toFixed(0)} – ${fh.upper1Sigma.toFixed(0)}`,
            metricLabel: 'Wartość heurystyki (nieskalibrowana)',
            metricValue: `${fh.predictedPrice.toFixed(1)}`,
            accentColor: isBullForecast ? T3_CSS.buy : T3_CSS.sell,
          };
          neuralSurfaceGroup.add(ringMesh);
        });

        const fCurve = new THREE.CatmullRomCurve3(pts);
        const fTubeGeo = new THREE.TubeGeometry(fCurve, 32, 0.09, 12, false);
        const fTubeMat = new THREE.MeshStandardMaterial({
          color: curQuant.neuralDirectionBias >= 0 ? T3.buy : T3.sell,
          emissive: curQuant.neuralDirectionBias >= 0 ? T3.buy : T3.sell,
          emissiveIntensity: GLOW,
          roughness: 0.35,
          metalness: 0.3,
        });
        const fTube = new THREE.Mesh(fTubeGeo, fTubeMat);
        neuralSurfaceGroup.add(fTube);
      }
    };

    rebuildMarketScene();
    // Scena zbudowana z bieżących danych — kolejna przebudowa dopiero po zmianie propsów
    dirtyRef.current = false;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Pointer move raycasting with throttling
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastRaycastTime < 50) return;
      lastRaycastTime = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(rootMarketGroup.children, true);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        if (hit.userData && hit.userData.title) {
          setHoveredNode(hit.userData as HoveredTensorNode);
          return;
        }
      }
      setHoveredNode(null);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // Resize observer
    const handleResize = () => {
      if (!container) return;
      const w = Math.max(300, container.clientWidth);
      const h = Math.max(260, container.clientHeight);
      camera.aspect = w / h;
      camera.fov = labFov(w / h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop with IntersectionObserver visibility guard & Software WebGL fenceSync pacing
    let startTimeMs = performance.now();
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
      const delta = Math.min(0.1, (nowMs - prevTimeMs) / 1000);
      prevTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (!isVisible) {
        timeoutId = window.setTimeout(tick, 250);
        return;
      }

      // Rebuild 3D geometry periodically as new live trades arrive
      // Przebudowa tylko gdy dane faktycznie się zmieniły (dirtyRef), z zachowanym throttlingiem 450 ms
      if (dirtyRef.current && elapsed - lastSceneBuildTick > 0.45) {
        lastSceneBuildTick = elapsed;
        dirtyRef.current = false;
        rebuildMarketScene();
      }

      // Smooth exponential camera preset transitions
      if (targetCamRef.current.active) {
        const lambda = 5.5;
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          targetCamRef.current.pos.x,
          lambda,
          delta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          targetCamRef.current.pos.y,
          lambda,
          delta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          targetCamRef.current.pos.z,
          lambda,
          delta
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          targetCamRef.current.lookAt.x,
          lambda,
          delta
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          targetCamRef.current.lookAt.y,
          lambda,
          delta
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          targetCamRef.current.lookAt.z,
          lambda,
          delta
        );
        if (camera.position.distanceTo(targetCamRef.current.pos) < 0.08) {
          targetCamRef.current.active = false;
        }
      }

      controls.update();

      // Głębia ostrości tylko gdy włączona — inaczej render bez post-processingu (taniej)
      if (bokehPass && composer && latestDataRef.current.dofEnabled) {
        const uniforms = bokehPass.uniforms as Record<string, { value: number }>;
        if (uniforms['focus']) {
          uniforms['focus'].value = latestDataRef.current.dofFocus;
        }
        if (uniforms['aperture']) {
          uniforms['aperture'].value = latestDataRef.current.dofAperture * 0.0001;
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

      // Geometrie, materiały i tekstury całej sceny + materiały współdzielone (mogą być poza sceną)
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

  return (
    <div className={SCENE_FRAME}>
      {/* Kontener WebGL */}
      <div ref={canvasMountRef} className="w-full h-full" />

      <HudHeader title="Liquidity Canyon · świece, arkusz L2, profil i strefy OB">
        Micro-price {Number.isFinite(quant.l2MicroPrice) ? quant.l2MicroPrice.toFixed(1) : '—'} · Nierównowaga L2{' '}
        {(quant.l2OrderbookImbalance * 100).toFixed(1)}% · Hurst {quant.hurstExponent}
      </HudHeader>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <HudButton onClick={() => applyCameraPreset('isometric')} icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />} label="Reset kamery" />
        {onToggleExpand && (
          <HudButton
            onClick={onToggleExpand}
            icon={isExpanded ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
            label={isExpanded ? 'Widok dzielony' : 'Pełny ekran'}
          />
        )}
      </div>

      {hoveredNode && (
        <HoverCard
          swatch={hoveredNode.accentColor}
          title={hoveredNode.title}
          subtitle={hoveredNode.subtitle}
          rows={[{ k: hoveredNode.metricLabel, v: hoveredNode.metricValue }]}
        />
      )}

      <SceneDock collapsed={dockCollapsed} onToggle={() => setDockCollapsed((prev) => !prev)}>
        <DockPresets<CameraPreset>
          ariaLabel="Kamera"
          value={cameraPreset}
          onChange={applyCameraPreset}
          options={[
            { id: 'isometric', label: 'Izometria' },
            { id: 'canyon', label: 'Kanion L2' },
            { id: 'trajectory', label: 'Trajektoria' },
            { id: 'topdown', label: 'Z góry' },
          ]}
        />
        <DockToggle on={showOBVolumes} onClick={() => setShowOBVolumes((v) => !v)}>
          <Layers className="w-3 h-3" aria-hidden="true" /> Strefy OB
        </DockToggle>
        <DockToggle on={showNeuralSurface} onClick={() => setShowNeuralSurface((v) => !v)}>
          <Eye className="w-3 h-3" aria-hidden="true" /> Trajektoria
        </DockToggle>
        <DockSlider label="Rozsunięcie Z" min={0.5} max={2} step={0.1} value={explodedScale} onChange={setExplodedScale} format={(v) => `${v.toFixed(1)}×`} />
        <DockToggle on={dofEnabled} onClick={() => setDofEnabled((v) => !v)}>
          <Focus className="w-3 h-3" aria-hidden="true" /> Głębia ostrości
        </DockToggle>
        {dofEnabled && (
          <>
            <DockSlider label="Ostrość" min={8} max={48} step={1} value={dofFocus} onChange={setDofFocus} format={(v) => `${v} m`} />
            <DockSlider label="Przysłona" min={0.4} max={4.5} step={0.2} value={dofAperture} onChange={setDofAperture} format={(v) => `f/${v.toFixed(1)}`} />
          </>
        )}
      </SceneDock>
    </div>
  );
};
