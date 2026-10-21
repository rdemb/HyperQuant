import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Cpu,
  Focus,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import {
  BackendQuantTelemetry,
  ExchangeId,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

interface ThreeOrderflowVortex3DProps {
  latestBar: OHLCVBar;
  shaakuni: ShaakuniState;
  quant: QuantMathMetrics;
  backendTelemetry: BackendQuantTelemetry | null;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

type VortexPreset = 'vortex' | 'montecarlo' | 'gammasurface' | 'icebergs';

interface HoveredVortexItem {
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
  accentColor: string;
}

const VENUE_NODES: {
  id: ExchangeId;
  name: string;
  isSpot: boolean;
  angle: number;
  radius: number;
}[] = [
  { id: 'HYPERLIQUID', name: 'Hyperliquid Perp', isSpot: false, angle: 0, radius: 8.5 },
  { id: 'BINANCE_FUTURES', name: 'Binance Futures', isSpot: false, angle: 0.57, radius: 9.2 },
  { id: 'BYBIT', name: 'Bybit Perp', isSpot: false, angle: 1.14, radius: 8.8 },
  { id: 'OKEX', name: 'OKX Swap', isSpot: false, angle: 1.71, radius: 9.0 },
  { id: 'DERIBIT', name: 'Deribit Perp', isSpot: false, angle: 2.28, radius: 8.6 },
  { id: 'BITMEX', name: 'BitMEX XBTUSD', isSpot: false, angle: 2.85, radius: 8.8 },
  { id: 'COINBASE', name: 'Coinbase Spot', isSpot: true, angle: 3.42, radius: 9.4 },
  { id: 'BINANCE', name: 'Binance Spot', isSpot: true, angle: 3.99, radius: 9.4 },
  { id: 'BITFINEX', name: 'Bitfinex Spot', isSpot: true, angle: 4.56, radius: 8.9 },
  { id: 'KRAKEN', name: 'Kraken Spot', isSpot: true, angle: 5.13, radius: 8.7 },
  { id: 'BITSTAMP', name: 'Bitstamp Spot', isSpot: true, angle: 5.7, radius: 8.6 },
];

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
  const [dofEnabled, setDofEnabled] = useState<boolean>(true);
  const [dofFocus, setDofFocus] = useState<number>(21);
  const [dofAperture, setDofAperture] = useState<number>(2.0);
  const [pulseSpeed, setPulseSpeed] = useState<number>(1.2);
  const [showMonteCarloFan, setShowMonteCarloFan] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
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
    } else if (p === 'gammasurface') {
      targetCamRef.current = {
        pos: new THREE.Vector3(-15, 11, 18),
        lookAt: new THREE.Vector3(0, -1.5, 0),
        active: true,
      };
    } else if (p === 'icebergs') {
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
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060911);
    scene.fog = new THREE.FogExp2(0x060911, 0.016);

    // 2. Studio Environment Map (RoomEnvironment + PMREMGenerator)
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 160);
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
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x060911, 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.3);
    keyLight.position.set(14, 26, 16);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x22d3ee, 1.5);
    rimLight.position.set(-18, 12, -14);
    scene.add(rimLight);

    // 4. Composite 3D Hero Core: Hyperliquid BTC Oracle-Mark Reactor (5-part composite THREE.Group)
    const coreReactorGroup = new THREE.Group();
    scene.add(coreReactorGroup);

    // Part 1: Inner Optical Crystal Octahedron
    const innerCoreGeo = new THREE.OctahedronGeometry(1.35, 1);
    const innerCoreMat = new THREE.MeshPhysicalMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.55,
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
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.35,
      roughness: 0.2,
      metalness: 0.92,
    });
    const ring1Mesh = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1Mesh.position.set(0, 1.2, 0);
    coreReactorGroup.add(ring1Mesh);

    // Part 3: Gold Anisotropic Gimbal Ring 2 (W-EQ Weekly Equilibrium Ring)
    const ring2Geo = new THREE.TorusGeometry(2.65, 0.055, 16, 64);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xd97706,
      emissiveIntensity: 0.3,
      roughness: 0.25,
      metalness: 0.88,
    });
    const ring2Mesh = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2Mesh.position.set(0, 1.2, 0);
    ring2Mesh.rotation.x = Math.PI / 3;
    coreReactorGroup.add(ring2Mesh);

    // Part 4: Grounded Reactor Base Pedestal
    const pedestalGeo = new THREE.CylinderGeometry(1.8, 2.4, 0.5, 32);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.85,
    });
    const pedestalMesh = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestalMesh.position.set(0, -2.5, 0);
    coreReactorGroup.add(pedestalMesh);

    // 5. Animated 3D Volatility, Gamma & Funding Topographic Wave Surface
    const planeSegments = 28;
    const wavePlaneGeo = new THREE.PlaneGeometry(28, 28, planeSegments, planeSegments);
    wavePlaneGeo.rotateX(-Math.PI / 2);
    const wavePlaneMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0369a1,
      emissiveIntensity: 0.22,
      roughness: 0.35,
      metalness: 0.65,
      wireframe: true,
      transparent: true,
      opacity: 0.42,
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
      const nodeColor =
        v.id === 'HYPERLIQUID'
          ? 0x22d3ee
          : v.isSpot
          ? 0x38bdf8
          : 0xc084fc;
      const nodeMat = new THREE.MeshStandardMaterial({
        color: nodeColor,
        emissive: nodeColor,
        emissiveIntensity: 0.4,
        roughness: 0.22,
        metalness: 0.8,
      });
      const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
      nodeMesh.castShadow = true;
      nodeMesh.layers.enable(1);
      nodeGroup.add(nodeMesh);

      // Node Orbital Ring
      const haloGeo = new THREE.TorusGeometry(0.75, 0.03, 12, 32);
      haloGeo.rotateX(Math.PI / 2);
      const haloMat = new THREE.MeshStandardMaterial({
        color: nodeColor,
        emissive: nodeColor,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.9,
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
        color: v.isSpot ? 0x0284c7 : 0x7e22ce,
        transparent: true,
        opacity: 0.35,
      });
      const conduitMesh = new THREE.Mesh(conduitGeo, conduitMat);
      venuesGroup.add(conduitMesh);

      // Create 2 animated energy pulse spheres per conduit
      for (let p = 0; p < 2; p++) {
        const pulseGeo = new THREE.SphereGeometry(0.13, 12, 12);
        const pulseMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.9,
          roughness: 0.1,
          metalness: 0.5,
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

    // Helper to clear dynamic groups
    const clearGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
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
      innerCoreMesh.userData = {
        title: `Hyperliquid BTC Oracle-Mark Reactor`,
        subtitle: `Mid: $${curPrice.toFixed(1)} · Oracle: $${(
          curBackend?.oraclePrice ?? curPrice
        ).toFixed(1)} · Basis: ${curBackend?.basisBps ?? -1.5} bps`,
        metricLabel: 'Open Interest & Funding',
        metricValue: `$${(
          (curBackend?.openInterestUsd ?? 3400000000) / 1e9
        ).toFixed(2)}B OI · ${
          curBackend?.fundingAnnualizedPct ?? 10.95
        }% APR`,
        accentColor: '#22d3ee',
      };

      // Update Venue Node sizes & hover metadata from live exchange delta
      venueNodeMeshes.forEach(({ id, mesh, halo }, idx) => {
        const exVol = curBar.exchanges[id] ?? { vbuy: 50000, vsell: 50000 };
        const delta = exVol.vbuy - exVol.vsell;
        const tot = Math.max(1, exVol.vbuy + exVol.vsell);
        const scale = Math.max(0.75, Math.min(1.85, 0.85 + tot / 1800000));
        mesh.scale.setScalar(scale);
        halo.scale.setScalar(scale);

        const isNetBuy = delta >= 0;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(isNetBuy ? 0x38bdf8 : 0xf43f5e);
        mat.emissive.setHex(isNetBuy ? 0x0284c7 : 0xbe123c);

        // Update corresponding pulse packet direction & color
        const p1 = pulsePackets[idx * 2];
        const p2 = pulsePackets[idx * 2 + 1];
        if (p1 && p2) {
          p1.inward = isNetBuy;
          p2.inward = isNetBuy;
          (p1.mesh.material as THREE.MeshStandardMaterial).color.setHex(
            isNetBuy ? 0x22d3ee : 0xf43f5e
          );
          (p1.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(
            isNetBuy ? 0x22d3ee : 0xf43f5e
          );
          (p2.mesh.material as THREE.MeshStandardMaterial).color.setHex(
            isNetBuy ? 0x22d3ee : 0xf43f5e
          );
          (p2.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(
            isNetBuy ? 0x22d3ee : 0xf43f5e
          );
        }

        mesh.userData = {
          title: `${VENUE_NODES[idx].name} Orderflow Node`,
          subtitle: `Buy: $${(exVol.vbuy / 1000).toFixed(0)}K · Sell: $${(
            exVol.vsell / 1000
          ).toFixed(0)}K`,
          metricLabel: 'Venue Net Delta',
          metricValue: `${delta >= 0 ? '+' : ''}$${(delta / 1000).toFixed(0)}K`,
          accentColor: isNetBuy ? '#38bdf8' : '#f43f5e',
        };
      });

      // Rebuild 3D Monte Carlo Jump-Diffusion Quantum Trajectories
      clearGroup(monteCarloGroup);
      if (showMC && curBackend?.monteCarlo?.sampledPaths) {
        const atr = Math.max(60, curShaakuni.atr14);
        curBackend.monteCarlo.sampledPaths.slice(0, 14).forEach((path, pIdx) => {
          const pts: THREE.Vector3[] = [];
          const angleSpread = ((pIdx - 7) / 7) * 0.55;
          path.points.forEach((pt) => {
            const r = pt.step * 0.48;
            const x = Math.cos(angleSpread) * r;
            const z = Math.sin(angleSpread) * r;
            const y = 1.2 + ((pt.price - curPrice) / (atr * 3)) * 2.8;
            pts.push(new THREE.Vector3(x, Math.max(-2.4, Math.min(6.5, y)), z));
          });

          if (pts.length > 2) {
            const curve = new THREE.CatmullRomCurve3(pts);
            const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.032, 6, false);
            const col =
              path.type === 'bull'
                ? 0x10b981
                : path.type === 'bear'
                ? 0xf43f5e
                : 0xfacc15;
            const tubeMat = new THREE.MeshBasicMaterial({
              color: col,
              transparent: true,
              opacity: 0.65,
            });
            const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
            monteCarloGroup.add(tubeMesh);
          }
        });
      }

      // Rebuild 3D Whale Iceberg & L2 Shield Pillars
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
        const col =
          w.pattern === 'Institutional Iceberg'
            ? 0xfacc15
            : isBid
            ? 0x10b981
            : 0xf43f5e;
        const pillarMat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 0.45,
          roughness: 0.2,
          metalness: 0.85,
        });
        const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
        pillarMesh.position.set(x, -2.5 + h / 2, z);
        pillarMesh.layers.enable(1);
        pillarMesh.userData = {
          title: `Hyperliquid L2 ${w.pattern} (${w.side})`,
          subtitle: `Price: $${w.price.toFixed(1)} · ${w.orderCount} resting orders`,
          metricLabel: 'Resting Depth',
          metricValue: `${w.sizeBtc} BTC ($${(w.sizeUsd / 1000).toFixed(0)}K)`,
          accentColor:
            w.pattern === 'Institutional Iceberg'
              ? '#facc15'
              : isBid
              ? '#10b981'
              : '#f43f5e',
        };
        whaleIcebergsGroup.add(pillarMesh);
      });

      // Update quant reference for unused warning avoidance
      void curQuant;
    };

    rebuildDynamicOverlays();

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
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Pre-allocated Vector3 for zero GC inside render loop
    const _pulsePos = new THREE.Vector3();
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

      if (elapsed - lastDynamicRebuild > 0.6) {
        lastDynamicRebuild = elapsed;
        rebuildDynamicOverlays();
      }

      // 1. Rotate Central Hyperliquid Oracle-Mark Core & Gimbal Rings
      innerCoreMesh.rotation.y += dt * 0.65;
      innerCoreMesh.rotation.x = Math.sin(elapsed * 1.2) * 0.25;
      ring1Mesh.rotation.z += dt * 0.45;
      ring1Mesh.rotation.x = Math.cos(elapsed * 0.8) * 0.4;
      ring2Mesh.rotation.y -= dt * 0.55;

      // 2. Animate Orderflow Energy Pulses along Exchange-to-Core Conduits
      const speedMult = latestRef.current.pulseSpeed;
      for (let i = 0; i < pulsePackets.length; i++) {
        const pkt = pulsePackets[i];
        pkt.progress = (pkt.progress + dt * pkt.speed * speedMult) % 1;
        const t = pkt.inward ? pkt.progress : 1 - pkt.progress;
        pkt.curve.getPointAt(t, _pulsePos);
        pkt.mesh.position.copy(_pulsePos);
      }

      // 3. Animate 3D Volatility & Gamma Squeeze Topographic Wave Surface
      const posAttr = wavePlaneGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        const dist = Math.sqrt(vx * vx + vz * vz);
        const waveY =
          Math.sin(dist * 0.55 - elapsed * 2.1) * 0.38 +
          Math.cos(vx * 0.35 + elapsed * 1.4) * 0.22;
        posAttr.setY(i, waveY);
      }
      posAttr.needsUpdate = true;

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

  const mc = backendTelemetry?.monteCarlo;

  return (
    <div className="relative w-full h-full min-h-[420px] bg-[#060911] overflow-hidden select-none border border-slate-800/80 rounded-lg">
      {/* Isolated WebGL Mount Container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Minimal Spec Header */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1 bg-[#090D16]/90 border border-slate-800 px-3 py-2 rounded-md">
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>3D Cross-Exchange Orderflow Vortex, Whale Icebergs & Monte Carlo Fan</span>
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          HL Open Interest: $
          {((backendTelemetry?.openInterestUsd ?? 3405000000) / 1e9).toFixed(3)}B (
          {backendTelemetry?.openInterestBtc?.toLocaleString() ?? '41,074'} BTC) ·
          Funding: {backendTelemetry?.fundingAnnualizedPct ?? 10.95}% APR · Basis:{' '}
          {backendTelemetry?.basisBps ?? -1.6} bps
        </div>
        {mc && (
          <div className="text-[11px] text-cyan-300 font-mono tabular-nums">
            Monte Carlo First-Passage Time: D-EQ ~{mc.expectedMinsToDEQ}m (
            {mc.probTouchDEQ2h}%) · PDH ~{mc.expectedMinsToPDH}m ({mc.probTouchPDH2h}
            %) · PDL ~{mc.expectedMinsToPDL}m ({mc.probTouchPDL2h}%)
          </div>
        )}
      </div>

      {/* Top-Right Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => applyPreset('vortex')}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Reset Vortex</span>
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
                <span>Full 3D Vortex</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Raycasted Hover Card */}
      {hoveredItem && (
        <div className="absolute top-24 left-3 z-10 pointer-events-none bg-[#090D16]/95 border border-slate-700 px-3.5 py-2.5 rounded-md shadow-xl max-w-xs">
          <div className="text-xs font-semibold text-white flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-xs"
              style={{ backgroundColor: hoveredItem.accentColor }}
            />
            <span>{hoveredItem.title}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
            {hoveredItem.subtitle}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-4 text-[11px] font-mono">
            <span className="text-slate-400">{hoveredItem.metricLabel}</span>
            <span className="text-cyan-300 font-semibold">
              {hoveredItem.metricValue}
            </span>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 max-w-[calc(100%-20px)] w-auto flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className={`px-3 py-1 text-[11px] font-medium text-slate-300 bg-[#0B101B]/95 hover:bg-slate-800 border border-slate-800 shadow-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
            dockCollapsed ? 'rounded-md' : 'rounded-t-md border-b-0'
          }`}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Pokaż kontrolki 3D Vortex</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ukryj kontrolki</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="bg-[#0B101B]/95 border border-slate-800 rounded-b-lg rounded-tl-lg px-3 py-2 shadow-2xl flex flex-wrap items-center justify-center gap-2 max-w-full">
            {/* Camera Presets */}
            <div className="flex items-center gap-1 bg-[#070A12] p-1 rounded-md border border-slate-800/80">
              <Camera className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5 shrink-0" />
              {(
                [
                  { id: 'vortex', label: '11-Venue' },
                  { id: 'montecarlo', label: 'Monte Carlo' },
                  { id: 'gammasurface', label: 'Gamma Wave' },
                  { id: 'icebergs', label: 'L2 Icebergs' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    preset === item.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Bokeh Depth of Field & Speed Sliders */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => setDofEnabled((v) => !v)}
                className={`px-2 py-0.5 rounded font-medium flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 ${
                  dofEnabled
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                <Focus className="w-3.5 h-3.5" />
                <span>DOF: {dofEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <label className="flex items-center gap-1 text-slate-300 whitespace-nowrap">
                <span className="text-slate-400">Focus:</span>
                <input
                  type="range"
                  min={8}
                  max={42}
                  step={1}
                  value={dofFocus}
                  onChange={(e) => setDofFocus(Number(e.target.value))}
                  className="w-12 accent-cyan-400 cursor-pointer"
                />
                <span className="font-mono text-cyan-300 w-6">{dofFocus}m</span>
              </label>

              <label className="flex items-center gap-1 text-slate-300 whitespace-nowrap">
                <span className="text-slate-400">Speed:</span>
                <input
                  type="range"
                  min={0.3}
                  max={3.0}
                  step={0.1}
                  value={pulseSpeed}
                  onChange={(e) => setPulseSpeed(Number(e.target.value))}
                  className="w-12 accent-cyan-400 cursor-pointer"
                />
                <span className="font-mono text-cyan-300 w-7">
                  {pulseSpeed.toFixed(1)}x
                </span>
              </label>

              <button
                type="button"
                onClick={() => setShowMonteCarloFan((v) => !v)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                  showMonteCarloFan
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-900 text-slate-500 border-slate-800'
                }`}
              >
                <Cpu className="w-3 h-3" />
                <span>MC Paths</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
