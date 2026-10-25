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
  L2OrderbookLevel,
  LiquidationHeatmapCell,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { GLOW, T3, T3_CSS, isNarrowViewport, labFov, labPixelRatio } from '../views/lab/tokens3d';
import { DockPresets, DockSlider, DockToggle, HoverCard, HudButton, HudHeader, SCENE_FRAME, SceneDock } from '../views/lab/hud';
import { tr } from '../i18n';
import { fmtFixed, fmtPrice } from '../ui/format';

// Scena „Liquidation Risk (szacunek)”: teren heurystycznego szacunku poziomów likwidacji (nie realne pozycje)
interface ThreeQuantumRiskHeatmap3DProps {
  currentPrice: number;
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  heatmap: LiquidationHeatmapCell[];
  bids: L2OrderbookLevel[];
  asks: L2OrderbookLevel[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onTriggerMagnetSignal?: (
    dir: 'LONG' | 'SHORT',
    title: string,
    reason: string
  ) => void;
}

type RiskTopoPreset = 'iso' | 'shortsqueeze' | 'longcascade' | 'topcontour';

interface HoveredMagnetPeak {
  title: string;
  priceLevel: string;
  strength: string;
  leverageTier: string;
  sideLabel: string;
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

export const ThreeQuantumRiskHeatmap3D: React.FC<
  ThreeQuantumRiskHeatmap3DProps
> = ({
  currentPrice,
  shaakuni,
  quant,
  heatmap,
  bids,
  asks,
  isExpanded = false,
  onToggleExpand,
  onTriggerMagnetSignal,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [preset, setPreset] = useState<RiskTopoPreset>('iso');
  // Głębia ostrości domyślnie wyłączona — czytelność danych ważniejsza od efektu
  const [dofEnabled, setDofEnabled] = useState<boolean>(false);
  const [dofFocus, setDofFocus] = useState<number>(22);
  const [dofAperture] = useState<number>(1.8);
  const [topoElevationGain, setTopoElevationGain] = useState<number>(1.3);
  const [showContourWireframe, setShowContourWireframe] =
    useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(isNarrowViewport);
  const [hoveredPeak, setHoveredPeak] = useState<HoveredMagnetPeak | null>(
    null
  );

  const latestRef = useRef({
    currentPrice,
    shaakuni,
    quant,
    heatmap,
    bids,
    asks,
    dofEnabled,
    dofFocus,
    dofAperture,
    topoElevationGain,
    showContourWireframe,
  });

  useEffect(() => {
    latestRef.current = {
      currentPrice,
      shaakuni,
      quant,
      heatmap,
      bids,
      asks,
      dofEnabled,
      dofFocus,
      dofAperture,
      topoElevationGain,
      showContourWireframe,
    };
  }, [
    currentPrice,
    shaakuni,
    quant,
    heatmap,
    bids,
    asks,
    dofEnabled,
    dofFocus,
    dofAperture,
    topoElevationGain,
    showContourWireframe,
  ]);

  // Flaga "dane zmienione": klastry, beacony i teren są przeliczane tylko gdy zmieniły się dane,
  // z których powstają — nie przy każdym ticku timera
  const dirtyRef = useRef<boolean>(true);

  useEffect(() => {
    dirtyRef.current = true;
  }, [currentPrice, shaakuni, quant, topoElevationGain]);

  const targetCamRef = useRef<{
    pos: THREE.Vector3;
    lookAt: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(0, 15.5, 22.5),
    lookAt: new THREE.Vector3(0, 0.2, 0),
    active: false,
  });

  const applyPreset = (p: RiskTopoPreset) => {
    setPreset(p);
    if (p === 'iso') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 15.5, 22.5),
        lookAt: new THREE.Vector3(0, 0.2, 0),
        active: true,
      };
    } else if (p === 'shortsqueeze') {
      targetCamRef.current = {
        pos: new THREE.Vector3(17, 10.5, 14),
        lookAt: new THREE.Vector3(4.5, 1.2, 0),
        active: true,
      };
    } else if (p === 'longcascade') {
      targetCamRef.current = {
        pos: new THREE.Vector3(-17, 10.5, 14),
        lookAt: new THREE.Vector3(-4.5, 1.2, 0),
        active: true,
      };
    } else if (p === 'topcontour') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 29.5, 2.5),
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

    const camera = new THREE.PerspectiveCamera(labFov(width / height), width / height, 0.5, 165);
    camera.position.set(0, 15.5, 22.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 58;
    controls.target.set(0, 0.2, 0);

    controls.addEventListener('start', () => {
      targetCamRef.current.active = false;
    });

    // 3. Three-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xc8d4e3, T3.bg, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.3);
    keyLight.position.set(14, 28, 16);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const blueFillLight = new THREE.PointLight(T3.ink2, 1.2, 36);
    blueFillLight.position.set(-14, 7, -8);
    scene.add(blueFillLight);

    const redMagnetLight = new THREE.PointLight(T3.zone, 1.2, 36);
    redMagnetLight.position.set(14, 9, 8);
    scene.add(redMagnetLight);

    // 4. Skala sekwencyjna jednego odcienia (zone): ciemno = słaby szacunek, jasno = silny.
    // Wartość to względna siła heurystyki (0..1), nie kwota w USD.
    const d3BlueToRedScale = d3
      .scaleSequential<string>((t) =>
        d3.interpolateRgbBasis(['#101826', '#232c4a', '#3f3f7a', '#6a62b8', '#9085e9', '#cdc7f7'])(t)
      )
      .domain([0, 1]);

    // LUT kolorów (256 wpisów RGB) budowana raz z tego samego interpolatora D3 —
    // zastępuje konwersję D3 → string CSS → THREE.Color dla każdego wierzchołka
    const LIQ_COLOR_LUT_SIZE = 256;
    const liqColorLut = new Float32Array(LIQ_COLOR_LUT_SIZE * 3);
    const _lutColor = new THREE.Color();
    for (let k = 0; k < LIQ_COLOR_LUT_SIZE; k++) {
      _lutColor.set(d3BlueToRedScale(k / (LIQ_COLOR_LUT_SIZE - 1)));
      liqColorLut[k * 3] = _lutColor.r;
      liqColorLut[k * 3 + 1] = _lutColor.g;
      liqColorLut[k * 3 + 2] = _lutColor.b;
    }

    // 5. 3D Topographic Terrain Mesh (68 Price Columns x 48 Leverage-Depth Rows)
    const segX = 68;
    const segZ = 48;
    const terrainWidth = 26;
    const terrainDepth = 18;
    const terrainGeo = new THREE.PlaneGeometry(
      terrainWidth,
      terrainDepth,
      segX,
      segZ
    );
    terrainGeo.rotateX(-Math.PI / 2);

    const vCount = terrainGeo.attributes.position.count;
    const colorAttr = new THREE.BufferAttribute(
      new Float32Array(vCount * 3),
      3
    );
    terrainGeo.setAttribute('color', colorAttr);

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.24,
      metalness: 0.42,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.position.y = -2.6;
    terrainMesh.receiveShadow = !isSoftwareGl;
    scene.add(terrainMesh);

    // Topographic Iso-Contour Wireframe Overlay
    const contourWireMat = new THREE.MeshBasicMaterial({
      color: T3.ink3,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    const contourWireMesh = new THREE.Mesh(terrainGeo, contourWireMat);
    contourWireMesh.position.y = -2.585;
    scene.add(contourWireMesh);

    // Reference Base Floor Grid
    const baseGrid = new THREE.GridHelper(28, 28, T3.lineStrong, T3.line);
    baseGrid.position.y = -2.65;
    scene.add(baseGrid);

    // Spot Price Center Laser Wall (Marks Current BTC Price = 0 on X axis)
    const spotPlaneGeo = new THREE.PlaneGeometry(0.08, 6.2, 1, 1);
    const spotPlaneMat = new THREE.MeshBasicMaterial({
      color: T3.ink1,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const spotLaserMesh = new THREE.Mesh(spotPlaneGeo, spotPlaneMat);
    spotLaserMesh.position.set(0, 0.4, 0);
    scene.add(spotLaserMesh);

    // Dynamic Group for 3D Magnet Peak Beacons & Target Rings
    const magnetPeaksGroup = new THREE.Group();
    scene.add(magnetPeaksGroup);

    // Materiały per-rebuild usunięte ze sceny — zwalniane dopiero po kolejnym renderze,
    // gdy nowe materiały trzymają już referencję do tych samych programów shaderów
    // (natychmiastowy dispose usunąłby program beaconów i wymusił ponowną kompilację)
    const pendingMaterialDisposal: THREE.Material[] = [];

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const c = grp.children[0] as THREE.Mesh;
        if (c.geometry) c.geometry.dispose();
        // Wszystkie materiały beaconów i pierścieni są tworzone per-rebuild
        if (c.material) {
          const materials = Array.isArray(c.material) ? c.material : [c.material];
          pendingMaterialDisposal.push(...materials);
        }
        grp.remove(c);
      }
    };

    // Precomputed Gaussian Liquidation Clusters updated from live LiquidityProfile + Shaakuni + Heatmap
    interface MagnetCluster {
      normX: number; // -13 to +13 on terrain
      normZ: number; // -9 to +9 on terrain (leverage tier)
      intensity: number; // 0..1 względna siła szacunku (nie kwota USD)
      price: number;
      leverageLabel: string;
      isShortSqueeze: boolean;
      tag: string;
    }

    let activeClusters: MagnetCluster[] = [];
    let lastRebuildTime = -10;

    // Wysokości, kolory (LUT) i normalne terenu zależą tylko od danych (activeClusters) —
    // przeliczane wyłącznie przy przebudowie, nie w każdej klatce.
    // Wysokości bez mnożnika gain: gain nakładany przez scale.y siatki w pętli renderu.
    const rebuildTerrainSurface = () => {
      // 1. Update 3D Topographic Vertices & Blue-to-Red Color Gradient from Liquidation Clusters
      const posAttr = terrainGeo.attributes.position;
      const colAttr = terrainGeo.attributes.color;

      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);

        let liqDensity = 0.04; // Baseline blue valley floor

        for (let c = 0; c < activeClusters.length; c++) {
          const cl = activeClusters[c];
          const dx = vx - cl.normX;
          const dz = vz - cl.normZ;
          // Anisotropic Gaussian ridge (sharper along price X, elongated along leverage Z)
          const distSq = (dx * dx) / 2.3 + (dz * dz) / 5.2;
          if (distSq < 6.5) {
            const contrib = cl.intensity * Math.exp(-distSq);
            if (contrib > liqDensity) {
              liqDensity = contrib;
            } else {
              liqDensity = Math.min(1.0, liqDensity + contrib * 0.28);
            }
          }
        }

        const normVal = Math.max(0, Math.min(1, liqDensity));

        // Elevation Y proportional to USD Liquidation size
        posAttr.setY(i, Math.pow(normVal, 1.35) * 4.8);

        // Blue-to-Red gradient color lookup
        // Indeks LUT 0..255 (NaN → 0, bez wyjścia poza tablicę)
        const lutIdx =
          (normVal > 0 ? (normVal < 1 ? Math.round(normVal * 255) : 255) : 0) * 3;
        colAttr.setXYZ(
          i,
          liqColorLut[lutIdx],
          liqColorLut[lutIdx + 1],
          liqColorLut[lutIdx + 2]
        );
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      terrainGeo.computeVertexNormals();
    };

    const rebuildMagnetClustersAndBeacons = () => {
      const {
        currentPrice: spot,
        shaakuni: curShaakuni,
        quant: curQuant,
        topoElevationGain: gain,
      } = latestRef.current;

      const profile = curQuant.liquidityProfile ?? [];
      const priceSpan = Math.max(450, curShaakuni.atr14 * 7.5);

      const clusters: MagnetCluster[] = [];

      // 1. Convert top LiquidityProfileBuckets & Liquidation Pools into 3D Topographic Gaussian Ridges
      profile.forEach((bucket, idx) => {
        const relPrice = bucket.price - spot;
        const normX = Math.max(
          -12.2,
          Math.min(12.2, (relPrice / priceSpan) * 12.0)
        );
        const isShort = bucket.price >= spot;

        // Distribute across leverage tiers (100x near front Z=+5, 20x mid Z=0, 5x deep Z=-5)
        const levOffset =
          Math.abs(relPrice) < priceSpan * 0.25
            ? 4.2 // 100x tight stops near current price
            : Math.abs(relPrice) < priceSpan * 0.55
            ? 0.0 // 20x swing stops
            : -4.2; // 5x deep structural stops

        const normZ =
          levOffset + Math.sin(idx * 1.7) * 2.1;

        // Siła = U(p) z profilu (bez sztucznych podbić); oś Z = umowny podział na dźwignię
        const intensity = Math.min(1.0, Math.max(0.12, bucket.gravityPotential * 0.92));

        clusters.push({
          normX,
          normZ,
          intensity,
          price: bucket.price,
          leverageLabel: `${levOffset > 2 ? '~100×' : levOffset === 0 ? '~20×' : '~5×'} ${tr('(umownie)', '(nominal)')}`,
          isShortSqueeze: isShort,
          tag: bucket.isPOC
            ? tr('POC + szacunek likwidacji', 'POC + liquidation estimate')
            : Math.abs(bucket.price - curQuant.primaryMagnetPrice) < 35
            ? tr('Najsilniejsze U(p)', 'Strongest U(p)')
            : isShort
            ? tr('Szac. likwidacje shortów', 'Est. short liquidations')
            : tr('Szac. likwidacje longów', 'Est. long liquidations'),
        });
      });

      // Intensywność PDH/PDL z danych: pula likwidacji najbliższego kubełka profilu
      // znormalizowana przez maksymalną pulę w profilu (0 gdy profil pusty / brak puli)
      const maxProfilePoolUsd = profile.reduce(
        (acc, b) => Math.max(acc, b.liquidationPoolUsd),
        0
      );
      const levelIntensityFromProfile = (levelPrice: number) => {
        if (profile.length === 0 || !(maxProfilePoolUsd > 0)) return 0;
        let nearest = profile[0];
        for (let k = 1; k < profile.length; k++) {
          if (
            Math.abs(profile[k].price - levelPrice) <
            Math.abs(nearest.price - levelPrice)
          ) {
            nearest = profile[k];
          }
        }
        const ratio = nearest.liquidationPoolUsd / maxProfilePoolUsd;
        return ratio > 0 ? Math.min(1, ratio) : 0;
      };

      // 2. Ensure Shaakuni PDH and PDL are represented as major 3D Magnet Ridges
      // Strona z danych: poziom powyżej ceny = szacowane likwidacje shortów, poniżej = longów
      if (curShaakuni.pdh) {
        const nx = Math.max(
          -12,
          Math.min(12, ((curShaakuni.pdh - spot) / priceSpan) * 12)
        );
        const pdhAbove = curShaakuni.pdh >= spot;
        clusters.push({
          normX: nx,
          normZ: 1.2,
          intensity: levelIntensityFromProfile(curShaakuni.pdh),
          price: curShaakuni.pdh,
          leverageLabel: tr('pula stopów przy PDH (założenie)', 'stop pool at PDH (assumption)'),
          isShortSqueeze: pdhAbove,
          tag: 'PDH',
        });
      }

      if (curShaakuni.pdl) {
        const nx = Math.max(
          -12,
          Math.min(12, ((curShaakuni.pdl - spot) / priceSpan) * 12)
        );
        const pdlAbove = curShaakuni.pdl >= spot;
        clusters.push({
          normX: nx,
          normZ: -1.2,
          intensity: levelIntensityFromProfile(curShaakuni.pdl),
          price: curShaakuni.pdl,
          leverageLabel: tr('pula stopów przy PDL (założenie)', 'stop pool at PDL (assumption)'),
          isShortSqueeze: pdlAbove,
          tag: 'PDL',
        });
      }

      activeClusters = clusters;
      // Teren zależy tylko od klastrów — przeliczany raz na przebudowę
      rebuildTerrainSurface();

      // 3. Rebuild 3D Magnet Peak Beacons & Target Rings for Top 6 Magnet Clusters
      clearGroup(magnetPeaksGroup);
      // 6 najsilniejszych szacunków + zawsze PDH/PDL (opis sceny obiecuje złote znaczniki poziomów)
      const isLevelTag = (c: MagnetCluster) => c.tag === 'PDH' || c.tag === 'PDL';
      const topMagnets = [
        ...clusters
          .filter((c) => !isLevelTag(c))
          .sort((a, b) => b.intensity - a.intensity)
          .slice(0, 6),
        ...clusters.filter(isLevelTag),
      ];

      topMagnets.forEach((m) => {
        const peakY =
          -2.6 + Math.pow(m.intensity, 1.35) * 4.8 * gain;

        // Znacznik szczytu: PDH/PDL w kolorze poziomu, pozostałe — jasny odcień skali
        const beaconGeo = new THREE.OctahedronGeometry(0.34, 1);
        const isLevel = m.tag === 'PDH' || m.tag === 'PDL';
        const colHex = isLevel ? T3.level : m.intensity >= 0.75 ? T3.ink1 : T3.zone;
        const beaconMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: GLOW,
          roughness: 0.4,
          metalness: 0.3,
        });
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
        beaconMesh.position.set(m.normX, peakY + 0.45, m.normZ);
        beaconMesh.layers.enable(1);

        beaconMesh.userData = {
          title: `${m.tag} · ${fmtPrice(m.price, 0)} ${m.isShortSqueeze ? '▲' : '▼'}`,
          priceLevel: `${fmtPrice(m.price, 1)} (${m.price >= spot ? '+' : '−'}${fmtFixed(Math.abs(((m.price - spot) / spot) * 100), 2)}%)`,
          strength: `${Math.round(m.intensity * 100)}% ${tr('maks.', 'of max')}`,
          leverageTier: m.leverageLabel,
          sideLabel: m.isShortSqueeze
            ? tr('Nad ceną: szacowane likwidacje shortów', 'Above price: estimated short liquidations')
            : tr('Pod ceną: szacowane likwidacje longów', 'Below price: estimated long liquidations'),
          accentColor: isLevel ? T3_CSS.level : T3_CSS.zone,
        } satisfies HoveredMagnetPeak;

        magnetPeaksGroup.add(beaconMesh);

        // Horizontal Target Halo Ring around the Peak
        const ringGeo = new THREE.TorusGeometry(0.68, 0.035, 10, 32);
        ringGeo.rotateX(Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: isLevel ? T3.level : T3.ink3,
          transparent: true,
          opacity: 0.6,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(m.normX, peakY + 0.15, m.normZ);
        magnetPeaksGroup.add(ringMesh);
      });
    };

    rebuildMagnetClustersAndBeacons();
    // Scena zbudowana z bieżących danych — kolejna przebudowa dopiero po zmianie propsów
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
      const hits = raycaster.intersectObjects(magnetPeaksGroup.children, true);
      if (hits.length > 0 && hits[0].object.userData?.title) {
        setHoveredPeak(hits[0].object.userData as HoveredMagnetPeak);
        return;
      }
      setHoveredPeak(null);
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

      // Przebudowa tylko gdy dane faktycznie się zmieniły (dirtyRef), z zachowanym throttlingiem 800 ms
      if (dirtyRef.current && elapsed - lastRebuildTime > 0.8) {
        lastRebuildTime = elapsed;
        dirtyRef.current = false;
        rebuildMagnetClustersAndBeacons();
      }

      const {
        topoElevationGain: curGain,
        showContourWireframe: showWire,
      } = latestRef.current;

      contourWireMesh.visible = showWire;
      // Mnożnik wysokości jako skala Y siatki — suwak działa natychmiast, bez przeliczania wierzchołków
      terrainMesh.scale.y = curGain;
      contourWireMesh.scale.y = curGain;

      // Teren nie pulsuje — dane nie powinny „falować” bez zmiany wartości.
      // Znaczniki szczytów obracają się powoli (ruch liniowy), żeby było widać, że są interaktywne.
      for (let i = 0; i < magnetPeaksGroup.children.length; i++) {
        const obj = magnetPeaksGroup.children[i];
        obj.rotation.y += dt * 0.4;
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

      // Geometrie, materiały i tekstury całej sceny + materiały czekające na odroczony dispose
      const disposedMaterials = new Set<THREE.Material>();
      disposeSceneGraph(scene, disposedMaterials);
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

  const magnetAbove = quant.primaryMagnetPrice >= currentPrice;
  const fuelTotal = quant.shortSqueezeFuelUsd + quant.longCascadeFuelUsd;
  const fuelAbovePct = fuelTotal > 0 ? Math.round((quant.shortSqueezeFuelUsd / fuelTotal) * 100) : null;

  return (
    <div className={SCENE_FRAME}>
      {/* Kontener WebGL */}
      <div ref={canvasMountRef} className="w-full h-full" />

      <HudHeader title={tr('Liquidation Risk (szacunek) · teren szacowanych poziomów likwidacji', 'Liquidation Risk (estimate) · terrain of estimated liquidation levels')}>
        {tr('Najsilniejsze U(p)', 'Strongest U(p)')} {fmtPrice(quant.primaryMagnetPrice, 0)} {magnetAbove ? '▲' : '▼'} ·{' '}
        {tr('udział szacunku nad / pod ceną', 'share of the estimate above / below price')}{' '}
        {fuelAbovePct !== null ? `${fuelAbovePct}% / ${100 - fuelAbovePct}%` : '—'}
        <span className="flex items-center gap-2 pt-1 font-sans text-ink-3">
          {tr('słaby', 'weak')}
          <span
            className="w-28 h-1.5 rounded-full"
            style={{ background: 'linear-gradient(90deg,#101826,#3f3f7a,#9085e9,#cdc7f7)' }}
            aria-hidden="true"
          />
          {tr('silny · względna siła, nie kwota USD', 'strong · relative strength, not a USD amount')}
        </span>
      </HudHeader>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {onTriggerMagnetSignal && (
          <HudButton
            emphasis
            onClick={() =>
              onTriggerMagnetSignal(
                magnetAbove ? 'LONG' : 'SHORT',
                tr(
                  `Liquidation Risk (szacunek): najsilniejsze U(p) ${magnetAbove ? 'nad' : 'pod'} ceną`,
                  `Liquidation Risk (estimate): strongest U(p) ${magnetAbove ? 'above' : 'below'} price`
                ),
                tr(
                  `Poziom ${fmtPrice(quant.primaryMagnetPrice, 0)} · udział szacunku nad/pod ceną ${fuelAbovePct !== null ? `${fuelAbovePct}%/${100 - fuelAbovePct}%` : 'n/a'} · szacunek z wolumenu, nie realne pozycje`,
                  `Level ${fmtPrice(quant.primaryMagnetPrice, 0)} · share of the estimate above/below price ${fuelAbovePct !== null ? `${fuelAbovePct}%/${100 - fuelAbovePct}%` : 'n/a'} · estimate from volume, not real positions`
                )
              )
            }
            icon={<ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />}
            label={`${tr('Przekaż do planu', 'Send to plan')} · ${magnetAbove ? '▲ Long' : '▼ Short'}`}
            title={tr('Przekazuje stronę najsilniejszego U(p) do Analizatora planu — plan ocenisz tam', 'Sends the side of the strongest U(p) to the Plan Analyzer, where you evaluate the plan')}
          />
        )}
        <HudButton onClick={() => applyPreset('iso')} icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />} label={tr('Reset kamery', 'Reset camera')} />
        {onToggleExpand && (
          <HudButton
            onClick={onToggleExpand}
            icon={isExpanded ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
            label={isExpanded ? tr('Widok dzielony', 'Split view') : tr('Pełny ekran', 'Full screen')}
          />
        )}
      </div>

      {hoveredPeak && (
        <HoverCard
          swatch={hoveredPeak.accentColor}
          title={hoveredPeak.title}
          subtitle={hoveredPeak.sideLabel}
          rows={[
            { k: tr('Cena', 'Price'), v: hoveredPeak.priceLevel },
            { k: tr('Siła szacunku', 'Estimate strength'), v: hoveredPeak.strength },
            { k: tr('Dźwignia', 'Leverage'), v: hoveredPeak.leverageTier },
          ]}
        />
      )}

      <SceneDock collapsed={dockCollapsed} onToggle={() => setDockCollapsed((v) => !v)}>
        <DockPresets<RiskTopoPreset>
          ariaLabel={tr('Kamera', 'Camera')}
          value={preset}
          onChange={applyPreset}
          options={[
            { id: 'iso', label: tr('Izometria', 'Isometric') },
            { id: 'shortsqueeze', label: tr('Nad ceną', 'Above price') },
            { id: 'longcascade', label: tr('Pod ceną', 'Below price') },
            { id: 'topcontour', label: tr('Z góry', 'Top-down') },
          ]}
        />
        <DockSlider label={tr('Wysokość', 'Height')} min={0.6} max={2.2} step={0.05} value={topoElevationGain} onChange={setTopoElevationGain} format={(v) => `${fmtFixed(v, 2)}×`} />
        <DockToggle on={showContourWireframe} onClick={() => setShowContourWireframe((v) => !v)}>
          {tr('Siatka', 'Wireframe')}
        </DockToggle>
        <DockToggle on={dofEnabled} onClick={() => setDofEnabled((v) => !v)}>
          <Focus className="w-3 h-3" aria-hidden="true" /> {tr('Głębia ostrości', 'Depth of field')}
        </DockToggle>
        {dofEnabled && <DockSlider label={tr('Ostrość', 'Focus')} min={10} max={40} step={1} value={dofFocus} onChange={setDofFocus} format={(v) => `${v} m`} />}
      </SceneDock>
    </div>
  );
};
