import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { Cpu, Focus, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import {
  BackendQuantTelemetry,
  ExchangeId,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';
import { GLOW, T3, T3_CSS, isNarrowViewport, labFov, labPixelRatio } from '../views/lab/tokens3d';
import { DockPresets, DockSlider, DockToggle, HoverCard, HudButton, HudHeader, SCENE_FRAME, SceneDock } from '../views/lab/hud';

interface ThreeOrderflowVortex3DProps {
  latestBar: OHLCVBar;
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  backendTelemetry: BackendQuantTelemetry | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

type VortexPreset = 'vortex' | 'montecarlo' | 'side' | 'top';

interface HoveredVortexItem {
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
  accentColor: string;
}

// Węzły tylko dla giełd z realnym źródłem: Hyperliquid (domyślnie) + 5 giełd CEX (opt-in, łączone z przeglądarki)
const VENUE_NODES: {
  id: ExchangeId;
  name: string;
  isSpot: boolean;
  angle: number;
  radius: number;
}[] = [
  { id: 'HYPERLIQUID', name: 'Hyperliquid Perp', isSpot: false, angle: 0, radius: 8.5 },
  { id: 'BINANCE_FUTURES', name: 'Binance Futures', isSpot: false, angle: 1.05, radius: 9.0 },
  { id: 'BYBIT', name: 'Bybit Perp', isSpot: false, angle: 2.09, radius: 8.8 },
  { id: 'OKEX', name: 'OKX Swap', isSpot: false, angle: 3.14, radius: 9.0 },
  { id: 'COINBASE', name: 'Coinbase Spot', isSpot: true, angle: 4.19, radius: 9.2 },
  { id: 'BINANCE', name: 'Binance Spot', isSpot: true, angle: 5.24, radius: 9.0 },
];

// Opis wzorca dużego zlecenia — heurystyka z liczby zleceń i wielkości poziomu, nie identyfikacja uczestnika
const WHALE_PATTERN_PL: Record<string, string> = {
  'Institutional Iceberg': 'Wiele zleceń na poziomie',
  'Passive Whale Wall': 'Duża ściana (≥ 3,5 BTC)',
  'Liquidity Shield': 'Skupisko płynności',
};

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

// Czas pierwszego dotknięcia poziomu z Monte Carlo: null = żadna ścieżka nie dotknęła poziomu w 2h → "n/a"
const formatFirstPassageMins = (mins: number | null) =>
  mins === null || !Number.isFinite(mins) ? 'n/a' : `~${mins}m`;

export const ThreeOrderflowVortex3D: React.FC<ThreeOrderflowVortex3DProps> = ({
  latestBar,
  shaakuni,
  quant,
  backendTelemetry,
  isExpanded = false,
  onToggleExpand,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [preset, setPreset] = useState<VortexPreset>('vortex');
  // Głębia ostrości domyślnie wyłączona — czytelność danych ważniejsza od efektu
  const [dofEnabled, setDofEnabled] = useState<boolean>(false);
  const [dofFocus, setDofFocus] = useState<number>(21);
  const [dofAperture] = useState<number>(2.0);
  const [pulseSpeed, setPulseSpeed] = useState<number>(1.2);
  const [showMonteCarloFan, setShowMonteCarloFan] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(isNarrowViewport);
  const [hoveredItem, setHoveredItem] = useState<HoveredVortexItem | null>(null);

  const latestRef = useRef({
    latestBar,
    shaakuni,
    quant,
    backendTelemetry,
    dofEnabled,
    dofFocus,
    dofAperture,
    pulseSpeed,
    showMonteCarloFan,
  });

  useEffect(() => {
    latestRef.current = {
      latestBar,
      shaakuni,
      quant,
      backendTelemetry,
      dofEnabled,
      dofFocus,
      dofAperture,
      pulseSpeed,
      showMonteCarloFan,
    };
  }, [
    latestBar,
    shaakuni,
    quant,
    backendTelemetry,
    dofEnabled,
    dofFocus,
    dofAperture,
    pulseSpeed,
    showMonteCarloFan,
  ]);

  // Flaga "dane zmienione": nakładki dynamiczne są przebudowywane tylko gdy zmieniły się dane,
  // z których powstają — nie przy każdym ticku timera
  const dirtyRef = useRef<boolean>(true);

  useEffect(() => {
    dirtyRef.current = true;
  }, [latestBar, shaakuni, backendTelemetry, showMonteCarloFan]);

  const targetCamRef = useRef<{
    pos: THREE.Vector3;
    lookAt: THREE.Vector3;
    active: boolean;
  }>({
    pos: new THREE.Vector3(0, 14, 21),
    lookAt: new THREE.Vector3(0, 0.5, 0),
    active: false,
  });

  const applyPreset = (p: VortexPreset) => {
    setPreset(p);
    if (p === 'vortex') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 14, 21),
        lookAt: new THREE.Vector3(0, 0.5, 0),
        active: true,
      };
    } else if (p === 'montecarlo') {
      targetCamRef.current = {
        pos: new THREE.Vector3(16, 8, 17),
        lookAt: new THREE.Vector3(3, 1.5, 0),
        active: true,
      };
    } else if (p === 'side') {
      targetCamRef.current = {
        pos: new THREE.Vector3(-15, 11, 18),
        lookAt: new THREE.Vector3(0, -1.5, 0),
        active: true,
      };
    } else if (p === 'top') {
      targetCamRef.current = {
        pos: new THREE.Vector3(0, 24, 6),
        lookAt: new THREE.Vector3(0, 0, 0),
        active: true,
      };
    }
  };

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software WebGL Guard per Three.js skill
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
    scene.fog = new THREE.FogExp2(T3.bg, 0.016);

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
    camera.position.set(0, 14, 21);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 58;
    controls.target.set(0, 0.5, 0);

    controls.addEventListener('start', () => {
      targetCamRef.current.active = false;
    });

    // 3. Three-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight(0xc8d4e3, T3.bg, 0.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.3);
    keyLight.position.set(14, 26, 16);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(T3.accent, 0.8);
    rimLight.position.set(-18, 12, -14);
    scene.add(rimLight);

    // 4. Composite 3D Hero Core: Hyperliquid BTC Oracle-Mark Reactor (5-part composite THREE.Group)
    const coreReactorGroup = new THREE.Group();
    scene.add(coreReactorGroup);

    // Part 1: Inner Optical Crystal Octahedron
    const innerCoreGeo = new THREE.OctahedronGeometry(1.35, 1);
    const innerCoreMat = new THREE.MeshPhysicalMaterial({
      color: T3.accent,
      emissive: T3.accent,
      emissiveIntensity: GLOW,
      roughness: 0.12,
      metalness: 0.15,
      transmission: isSoftwareGl ? 0 : 0.88,
      transparent: true,
      opacity: isSoftwareGl ? 0.55 : 0.95,
      ior: 1.65,
      thickness: 1.5,
    });
    const innerCoreMesh = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    innerCoreMesh.position.set(0, 1.2, 0);
    innerCoreMesh.layers.enable(1);
    coreReactorGroup.add(innerCoreMesh);

    // Part 2: Brushed Titanium Gimbal Ring 1 (D-EQ Equilibrium Ring)
    const ring1Geo = new THREE.TorusGeometry(2.1, 0.07, 16, 64);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: T3.ink3,
      roughness: 0.35,
      metalness: 0.7,
    });
    const ring1Mesh = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1Mesh.position.set(0, 1.2, 0);
    coreReactorGroup.add(ring1Mesh);

    // Part 3: Gold Anisotropic Gimbal Ring 2 (W-EQ Weekly Equilibrium Ring)
    const ring2Geo = new THREE.TorusGeometry(2.65, 0.055, 16, 64);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: T3.lineStrong,
      roughness: 0.4,
      metalness: 0.7,
    });
    const ring2Mesh = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2Mesh.position.set(0, 1.2, 0);
    ring2Mesh.rotation.x = Math.PI / 3;
    coreReactorGroup.add(ring2Mesh);

    // Part 4: Grounded Reactor Base Pedestal
    const pedestalGeo = new THREE.CylinderGeometry(1.8, 2.4, 0.5, 32);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: T3.surface2,
      roughness: 0.35,
      metalness: 0.85,
    });
    const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestalMesh.position.set(0, -2.5, 0);
    coreReactorGroup.add(pedestalMesh);

    // 5. Statyczna siatka podłoża (dawniej animowana „fala gamma” bez danych — usunięta jako dekoracja)
    const planeSegments = 28;
    const wavePlaneGeo = new THREE.PlaneGeometry(28, 28, planeSegments, planeSegments);
    wavePlaneGeo.rotateX(-Math.PI / 2);
    const wavePlaneMat = new THREE.MeshBasicMaterial({
      color: T3.lineStrong,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });
    const waveSurfaceMesh = new THREE.Mesh(wavePlaneGeo, wavePlaneMat);
    waveSurfaceMesh.position.set(0, -2.8, 0);
    scene.add(waveSurfaceMesh);

    // 6. Dynamic Groups for Orbital Venue Nodes, Flow Pulses, Monte Carlo Paths & Whale Icebergs
    const venuesGroup = new THREE.Group();
    const pulsesGroup = new THREE.Group();
    const monteCarloGroup = new THREE.Group();
    const whaleIcebergsGroup = new THREE.Group();
    scene.add(venuesGroup, pulsesGroup, monteCarloGroup, whaleIcebergsGroup);

    // Build 11 Orbital Exchange Nodes & Spline Conduits + Animated Pulse Packets
    const pulsePackets: {
      mesh: THREE.Mesh;
      curve: THREE.CatmullRomCurve3;
      progress: number;
      speed: number;
      inward: boolean;
    }[] = [];

    const venueNodeMeshes: { id: ExchangeId; mesh: THREE.Mesh; halo: THREE.Mesh }[] = [];

    VENUE_NODES.forEach((v, idx) => {
      const x = Math.cos(v.angle) * v.radius;
      const z = Math.sin(v.angle) * v.radius;
      const y = v.isSpot ? 0.6 : -0.2;

      const nodeGroup = new THREE.Group();
      nodeGroup.position.set(x, y, z);

      // Node Body
      const nodeGeo = v.isSpot
        ? new THREE.OctahedronGeometry(0.52, 0)
        : new THREE.CylinderGeometry(0.45, 0.45, 0.7, 16);
      // Kolor węzła ustawiany w przebudowie: kupno/sprzedaż z danych, szary = brak danych
      const nodeColor = T3.lineStrong;
      const nodeMat = new THREE.MeshStandardMaterial({
        color: nodeColor,
        emissive: nodeColor,
        emissiveIntensity: GLOW,
        roughness: 0.4,
        metalness: 0.35,
      });
      const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
      nodeMesh.castShadow = true;
      nodeMesh.layers.enable(1);
      nodeGroup.add(nodeMesh);

      // Node Orbital Ring
      const haloGeo = new THREE.TorusGeometry(0.75, 0.03, 12, 32);
      haloGeo.rotateX(Math.PI / 2);
      // Pierścień: akcent dla Hyperliquid (źródło domyślne), linia dla CEX (opt-in)
      const haloMat = new THREE.MeshStandardMaterial({
        color: v.id === 'HYPERLIQUID' ? T3.accent : T3.lineStrong,
        roughness: 0.4,
        metalness: 0.5,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      nodeGroup.add(haloMesh);

      venuesGroup.add(nodeGroup);
      venueNodeMeshes.push({ id: v.id, mesh: nodeMesh, halo: haloMesh });

      // Conduit Curve from Venue Node to Central BTC Reactor Core
      const midPoint = new THREE.Vector3(
        x * 0.48,
        1.9 + (idx % 3) * 0.45,
        z * 0.48
      );
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, y, z),
        midPoint,
        new THREE.Vector3(0, 1.2, 0),
      ]);

      const conduitGeo = new THREE.TubeGeometry(curve, 28, 0.025, 6, false);
      const conduitMat = new THREE.MeshBasicMaterial({
        color: T3.lineStrong,
        transparent: true,
        opacity: 0.7,
      });
      const conduitMesh = new THREE.Mesh(conduitGeo, conduitMat);
      venuesGroup.add(conduitMesh);

      // Create 2 animated energy pulse spheres per conduit
      for (let p = 0; p < 2; p++) {
        const pulseGeo = new THREE.SphereGeometry(0.13, 12, 12);
        const pulseMat = new THREE.MeshStandardMaterial({
          color: T3.ink3,
          emissive: T3.ink3,
          emissiveIntensity: GLOW * 2,
          roughness: 0.3,
          metalness: 0.3,
        });
        const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
        pulsesGroup.add(pulseMesh);

        pulsePackets.push({
          mesh: pulseMesh,
          curve,
          progress: (idx * 0.13 + p * 0.5) % 1,
          speed: 0.32 + (idx % 4) * 0.06,
          inward: true,
        });
      }
    });

    // Materiały per-rebuild usunięte ze sceny — zwalniane dopiero po kolejnym renderze,
    // gdy nowe materiały trzymają już referencję do tych samych programów shaderów
    // (natychmiastowy dispose usunąłby program i wymusił ponowną kompilację)
    const pendingMaterialDisposal: THREE.Material[] = [];

    // Helper to clear dynamic groups
    const clearGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
        // Wszystkie materiały w czyszczonych grupach (MC, whale) są tworzone per-rebuild
        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          pendingMaterialDisposal.push(...materials);
        }
        group.remove(child);
      }
    };

    let lastDynamicRebuild = 0;
    const rebuildDynamicOverlays = () => {
      const {
        latestBar: curBar,
        shaakuni: curShaakuni,
        quant: curQuant,
        backendTelemetry: curBackend,
        showMonteCarloFan: showMC,
      } = latestRef.current;

      if (!curBar) return;
      const curPrice = curBar.close;

      // Update Central Core UserData
      // Brak telemetrii backendu → "—" zamiast zakodowanych na sztywno wartości wyglądających na live
      innerCoreMesh.userData = {
        title: `Hyperliquid BTC-PERP · mark / oracle`,
        subtitle: `Mid: $${curPrice.toFixed(1)} · Oracle: ${
          curBackend ? `$${curBackend.oraclePrice.toFixed(1)}` : '—'
        } · Basis: ${curBackend ? `${curBackend.basisBps} bps` : '—'}`,
        metricLabel: 'Open interest · funding (APR)',
        metricValue: curBackend
          ? `$${(curBackend.openInterestUsd / 1e9).toFixed(2)}B OI · ${
              curBackend.fundingAnnualizedPct
            }% APR`
          : '— OI · — APR',
        accentColor: T3_CSS.accent,
      };

      // Update Venue Node sizes & hover metadata from live exchange delta
      venueNodeMeshes.forEach(({ id, mesh, halo }, idx) => {
        // Brak danych giełdy → węzeł szary, impulsy ukryte (bez fikcyjnego przepływu)
        const exVol = curBar.exchanges[id] ?? { vbuy: 0, vsell: 0 };
        const delta = exVol.vbuy - exVol.vsell;
        const hasData = exVol.vbuy + exVol.vsell > 0;
        const tot = Math.max(1, exVol.vbuy + exVol.vsell);
        const scale = hasData ? Math.max(0.75, Math.min(1.85, 0.85 + tot / 1800000)) : 0.7;
        mesh.scale.setScalar(scale);
        halo.scale.setScalar(scale);

        const isNetBuy = delta >= 0;
        const nodeHex = !hasData ? T3.lineStrong : isNetBuy ? T3.buy : T3.sell;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(nodeHex);
        mat.emissive.setHex(nodeHex);

        // Impulsy na przewodzie: kierunek = przewaga (do środka = kupno), kolor = strona
        const p1 = pulsePackets[idx * 2];
        const p2 = pulsePackets[idx * 2 + 1];
        if (p1 && p2) {
          for (const p of [p1, p2]) {
            p.inward = isNetBuy;
            p.mesh.visible = hasData;
            const pm = p.mesh.material as THREE.MeshStandardMaterial;
            pm.color.setHex(isNetBuy ? T3.buy : T3.sell);
            pm.emissive.setHex(isNetBuy ? T3.buy : T3.sell);
          }
        }

        const venue = VENUE_NODES[idx];
        mesh.userData = {
          title: `${venue.name}${hasData ? (isNetBuy ? ' ▲' : ' ▼') : ''}`,
          subtitle: hasData
            ? `Bieżąca świeca · kupno $${(exVol.vbuy / 1000).toFixed(0)}K · sprzedaż $${(exVol.vsell / 1000).toFixed(0)}K`
            : id === 'HYPERLIQUID'
            ? 'Brak transakcji w bieżącej świecy'
            : 'Brak danych — źródła CEX są wyłączone (opt-in w Źródłach)',
          metricLabel: 'Delta netto',
          metricValue: hasData ? `${delta >= 0 ? '+' : '−'}$${(Math.abs(delta) / 1000).toFixed(0)}K` : '—',
          accentColor: !hasData ? T3_CSS.ink3 : isNetBuy ? T3_CSS.buy : T3_CSS.sell,
        };
      });

      // Ścieżki Monte Carlo (Merton jump-diffusion) — model, nie prognoza
      clearGroup(monteCarloGroup);
      if (showMC && curBackend?.monteCarlo?.sampledPaths) {
        // Math.max(60, NaN) = NaN — przy braku ATR używamy wartości minimalnej
        const atr = Number.isFinite(curShaakuni.atr14)
          ? Math.max(60, curShaakuni.atr14)
          : 60;
        curBackend.monteCarlo.sampledPaths.slice(0, 14).forEach((path, pIdx) => {
          const pts: THREE.Vector3[] = [];
          const angleSpread = ((pIdx - 7) / 7) * 0.55;
          path.points.forEach((pt) => {
            const r = pt.step * 0.48;
            const x = Math.cos(angleSpread) * r;
            const z = Math.sin(angleSpread) * r;
            const y = 1.2 + ((pt.price - curPrice) / (atr * 3)) * 2.8;
            // Pomijamy punkty z NaN/Infinity — zepsułyby geometrię TubeGeometry
            if (!Number.isFinite(y) || !Number.isFinite(r)) return;
            pts.push(new THREE.Vector3(x, Math.max(-2.4, Math.min(6.5, y)), z));
          });

          if (pts.length > 2) {
            const curve = new THREE.CatmullRomCurve3(pts);
            const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.032, 6, false);
            const col = path.type === 'bull' ? T3.buy : path.type === 'bear' ? T3.sell : T3.ink3;
            const tubeMat = new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.5,
            });
            const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
            monteCarloGroup.add(tubeMesh);
          }
        });
      }

      // Duże zlecenia w arkuszu HL (próg: ≥ 1,2 BTC lub ≥ 10 zleceń na poziomie)
      clearGroup(whaleIcebergsGroup);
      const whaleList = curBackend?.whaleNodes ?? [];
      whaleList.forEach((w, wIdx) => {
        const angle = (wIdx / Math.max(1, whaleList.length)) * Math.PI * 2;
        const radius = 4.6;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const h = Math.max(0.4, Math.min(3.5, w.sizeBtc * 0.45));

        const pillarGeo = new THREE.CylinderGeometry(0.18, 0.28, h, 6);
        const isBid = w.side === 'BID';
        const col = isBid ? T3.buy : T3.sell;
        const pillarMat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: GLOW,
          roughness: 0.4,
          metalness: 0.35,
        });
        const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
        pillarMesh.position.set(x, -2.5 + h / 2, z);
        pillarMesh.layers.enable(1);
        pillarMesh.userData = {
          title: `Arkusz HL · ${isBid ? 'BID ▲' : 'ASK ▼'} · ${WHALE_PATTERN_PL[w.pattern] ?? 'Duże zlecenie'}`,
          subtitle: `Cena ${w.price.toFixed(1)} · liczba zleceń na poziomie: ${w.orderCount}`,
          metricLabel: 'Płynność na poziomie',
          metricValue: `${w.sizeBtc} BTC ($${(w.sizeUsd / 1000).toFixed(0)}K)`,
          accentColor: isBid ? T3_CSS.buy : T3_CSS.sell,
        };
        whaleIcebergsGroup.add(pillarMesh);
      });

      // Update quant reference for unused warning avoidance
      void curQuant;
    };

    rebuildDynamicOverlays();
    // Nakładki zbudowane z bieżących danych — kolejna przebudowa dopiero po zmianie propsów
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
        [innerCoreMesh, ...venuesGroup.children, ...whaleIcebergsGroup.children],
        true
      );
      if (hits.length > 0 && hits[0].object.userData?.title) {
        setHoveredItem(hits[0].object.userData as HoveredVortexItem);
        return;
      }
      setHoveredItem(null);
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);

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

    // Pre-allocated Vector3 for zero GC inside render loop
    const _pulsePos = new THREE.Vector3();
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

      // Przebudowa tylko gdy dane faktycznie się zmieniły (dirtyRef), z zachowanym throttlingiem 600 ms
      if (dirtyRef.current && elapsed - lastDynamicRebuild > 0.6) {
        lastDynamicRebuild = elapsed;
        dirtyRef.current = false;
        rebuildDynamicOverlays();
      }

      // 1. Powolny obrót rdzenia i pierścieni (ruch liniowy, spokojny)
      innerCoreMesh.rotation.y += dt * 0.3;
      ring1Mesh.rotation.z += dt * 0.2;
      ring2Mesh.rotation.y -= dt * 0.25;

      // 2. Animate Orderflow Energy Pulses along Exchange-to-Core Conduits
      const speedMult = latestRef.current.pulseSpeed;
      for (let i = 0; i < pulsePackets.length; i++) {
        const pkt = pulsePackets[i];
        pkt.progress = (pkt.progress + dt * pkt.speed * speedMult) % 1;
        const t = pkt.inward ? pkt.progress : 1 - pkt.progress;
        pkt.curve.getPointAt(t, _pulsePos);
        pkt.mesh.position.copy(_pulsePos);
      }

      // 4. Smooth Camera Damping
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

  const mc = backendTelemetry?.monteCarlo;

  return (
    <div className={SCENE_FRAME}>
      {/* Kontener WebGL */}
      <div ref={canvasMountRef} className="w-full h-full" />

      <HudHeader title="Orderflow Vortex · przepływ agresora per giełda (bieżąca świeca)">
        {/* Brak telemetrii → „—” zamiast wartości wyglądających na live */}
        OI {backendTelemetry ? `$${(backendTelemetry.openInterestUsd / 1e9).toFixed(2)}B` : '—'} · Funding{' '}
        {backendTelemetry ? `${backendTelemetry.fundingAnnualizedPct}% APR` : '—'} · Basis{' '}
        {backendTelemetry ? `${backendTelemetry.basisBps} bps` : '—'}
        {mc && (
          <span className="block text-ink-3">
            Monte Carlo (model), dotknięcie w 2 h: D-EQ {mc.probTouchDEQ2h}% ({formatFirstPassageMins(mc.expectedMinsToDEQ)}) · PDH{' '}
            {mc.probTouchPDH2h}% ({formatFirstPassageMins(mc.expectedMinsToPDH)}) · PDL {mc.probTouchPDL2h}% (
            {formatFirstPassageMins(mc.expectedMinsToPDL)})
          </span>
        )}
      </HudHeader>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <HudButton onClick={() => applyPreset('vortex')} icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />} label="Reset kamery" />
        {onToggleExpand && (
          <HudButton
            onClick={onToggleExpand}
            icon={isExpanded ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
            label={isExpanded ? 'Widok dzielony' : 'Pełny ekran'}
          />
        )}
      </div>

      {hoveredItem && (
        <HoverCard
          swatch={hoveredItem.accentColor}
          title={hoveredItem.title}
          subtitle={hoveredItem.subtitle}
          rows={[{ k: hoveredItem.metricLabel, v: hoveredItem.metricValue }]}
        />
      )}

      <SceneDock collapsed={dockCollapsed} onToggle={() => setDockCollapsed((v) => !v)}>
        <DockPresets<VortexPreset>
          ariaLabel="Kamera"
          value={preset}
          onChange={applyPreset}
          options={[
            { id: 'vortex', label: 'Giełdy' },
            { id: 'montecarlo', label: 'Monte Carlo' },
            { id: 'side', label: 'Z boku' },
            { id: 'top', label: 'Z góry' },
          ]}
        />
        <DockToggle on={showMonteCarloFan} onClick={() => setShowMonteCarloFan((v) => !v)}>
          <Cpu className="w-3 h-3" aria-hidden="true" /> Ścieżki MC
        </DockToggle>
        <DockSlider label="Tempo impulsów" min={0.3} max={3} step={0.1} value={pulseSpeed} onChange={setPulseSpeed} format={(v) => `${v.toFixed(1)}×`} />
        <DockToggle on={dofEnabled} onClick={() => setDofEnabled((v) => !v)}>
          <Focus className="w-3 h-3" aria-hidden="true" /> Głębia ostrości
        </DockToggle>
        {dofEnabled && <DockSlider label="Ostrość" min={8} max={42} step={1} value={dofFocus} onChange={setDofFocus} format={(v) => `${v} m`} />}
      </SceneDock>
    </div>
  );
};
