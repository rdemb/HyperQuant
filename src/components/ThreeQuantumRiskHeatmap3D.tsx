import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import * as d3 from 'd3';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Flame,
  Focus,
  Magnet,
  Maximize2,
  Minimize2,
  Mountain,
  RotateCcw,
  Zap,
} from 'lucide-react';
import {
  L2OrderbookLevel,
  LiquidationHeatmapCell,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

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
  totalLiqUsd: string;
  leverageTier: string;
  magnetPullPct: string;
  sideLabel: string;
  accentColor: string;
}

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
  const [dofEnabled, setDofEnabled] = useState<boolean>(true);
  const [dofFocus, setDofFocus] = useState<number>(22);
  const [dofAperture, setDofAperture] = useState<number>(1.8);
  const [topoElevationGain, setTopoElevationGain] = useState<number>(1.3);
  const [showContourWireframe, setShowContourWireframe] =
    useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
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
    renderer.toneMappingExposure = 1.2;
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

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 165);
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
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x060911, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.3);
    keyLight.position.set(14, 28, 16);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const blueFillLight = new THREE.PointLight(0x2563eb, 4.0, 36);
    blueFillLight.position.set(-14, 7, -8);
    scene.add(blueFillLight);

    const redMagnetLight = new THREE.PointLight(0xef4444, 4.8, 36);
    redMagnetLight.position.set(14, 9, 8);
    scene.add(redMagnetLight);

    // 4. D3 Blue-to-Red Color Gradient Scale based on Total USD Liquidation Size
    // 0.0 (Low USD Liq) = Deep Blue (#1e3a8a / #2563eb)
    // 0.35 (Medium Liq) = Cyan-Blue (#0284c7 / #06b6d4)
    // 0.68 (High Liq Cluster) = Amber-Orange (#f59e0b / #f97316)
    // 1.0 (Extreme Magnet Peak) = Crimson-Red (#e11d48 / #ff1e42)
    const d3BlueToRedScale = d3
      .scaleSequential<string>((t) =>
        d3.interpolateRgbBasis([
          '#172554', // Deep Midnight Blue (Minimal Liquidation)
          '#1d4ed8', // Royal Cobalt Blue
          '#0284c7', // Electric Sky Blue
          '#06b6d4', // Cyan Transition
          '#f59e0b', // High Leverage Amber Cluster
          '#f97316', // Intense Orange Ridge
          '#ef4444', // Crimson Liquidation Magnet Peak
          '#ff1e42', // Ultra-Dense Red Magnet Core
        ])(t)
      )
      .domain([0, 1]);

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
      color: 0x93c5fd,
      wireframe: true,
      transparent: true,
      opacity: 0.16,
    });
    const contourWireMesh = new THREE.Mesh(terrainGeo, contourWireMat);
    contourWireMesh.position.y = -2.585;
    scene.add(contourWireMesh);

    // Reference Base Floor Grid
    const baseGrid = new THREE.GridHelper(28, 28, 0x1e293b, 0x0f172a);
    baseGrid.position.y = -2.65;
    scene.add(baseGrid);

    // Spot Price Center Laser Wall (Marks Current BTC Price = 0 on X axis)
    const spotPlaneGeo = new THREE.PlaneGeometry(0.08, 6.2, 1, 1);
    const spotPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const spotLaserMesh = new THREE.Mesh(spotPlaneGeo, spotPlaneMat);
    spotLaserMesh.position.set(0, 0.4, 0);
    scene.add(spotLaserMesh);

    // Dynamic Group for 3D Magnet Peak Beacons & Target Rings
    const magnetPeaksGroup = new THREE.Group();
    scene.add(magnetPeaksGroup);

    const clearGroup = (grp: THREE.Group) => {
      while (grp.children.length > 0) {
        const c = grp.children[0] as THREE.Mesh;
        if (c.geometry) c.geometry.dispose();
        grp.remove(c);
      }
    };

    // Precomputed Gaussian Liquidation Clusters updated from live LiquidityProfile + Shaakuni + Heatmap
    interface MagnetCluster {
      normX: number; // -13 to +13 on terrain
      normZ: number; // -9 to +9 on terrain (leverage tier)
      intensity: number; // 0..1 normalized USD liquidation size
      usdPoolM: number; // $M liquidation pool
      price: number;
      leverageLabel: string;
      isShortSqueeze: boolean;
      tag: string;
    }

    let activeClusters: MagnetCluster[] = [];
    let lastRebuildTime = -10;

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

        const usdPoolM = Number(
          Math.max(
            0.8,
            (bucket.liquidationPoolUsd / 1e6) * 2.4 +
              bucket.gravityPotential * 14.5
          ).toFixed(2)
        );

        const intensity = Math.min(
          1.0,
          Math.max(0.12, bucket.gravityPotential * 0.92 + (idx % 3 === 0 ? 0.12 : 0))
        );

        clusters.push({
          normX,
          normZ,
          intensity,
          usdPoolM,
          price: bucket.price,
          leverageLabel:
            levOffset > 2
              ? '100x High-Leverage Cluster'
              : levOffset === 0
              ? '20x Swing Leverage Pool'
              : '5x Institutional Margin Wall',
          isShortSqueeze: isShort,
          tag: bucket.isPOC
            ? 'POC + LIQ MAGNET'
            : Math.abs(bucket.price - curQuant.primaryMagnetPrice) < 35
            ? 'PRIMARY MAGNET U(p)'
            : isShort
            ? 'SHORT SQUEEZE POOL'
            : 'LONG CASCADE POOL',
        });
      });

      // 2. Ensure Shaakuni PDH and PDL are represented as major 3D Magnet Ridges
      if (curShaakuni.pdh) {
        const nx = Math.max(
          -12,
          Math.min(12, ((curShaakuni.pdh - spot) / priceSpan) * 12)
        );
        clusters.push({
          normX: nx,
          normZ: 1.2,
          intensity: 0.96,
          usdPoolM: Number(
            Math.max(16.4, curQuant.shortSqueezeFuelUsd / 1e5).toFixed(1)
          ),
          price: curShaakuni.pdh,
          leverageLabel: '20x–100x PDH Stop-Loss Cluster',
          isShortSqueeze: true,
          tag: 'PDH MAGNET PEAK',
        });
      }

      if (curShaakuni.pdl) {
        const nx = Math.max(
          -12,
          Math.min(12, ((curShaakuni.pdl - spot) / priceSpan) * 12)
        );
        clusters.push({
          normX: nx,
          normZ: -1.2,
          intensity: 0.94,
          usdPoolM: Number(
            Math.max(15.2, curQuant.longCascadeFuelUsd / 1e5).toFixed(1)
          ),
          price: curShaakuni.pdl,
          leverageLabel: '20x–100x PDL Stop-Loss Cluster',
          isShortSqueeze: false,
          tag: 'PDL MAGNET PEAK',
        });
      }

      activeClusters = clusters;

      // 3. Rebuild 3D Magnet Peak Beacons & Target Rings for Top 6 Magnet Clusters
      clearGroup(magnetPeaksGroup);
      const topMagnets = [...clusters]
        .sort((a, b) => b.intensity - a.intensity)
        .slice(0, 6);

      topMagnets.forEach((m) => {
        const peakY =
          -2.6 + Math.pow(m.intensity, 1.35) * 4.8 * gain;

        // Glowing Red/Amber Peak Beacon Sphere
        const beaconGeo = new THREE.OctahedronGeometry(0.34, 1);
        const colHex = m.intensity >= 0.75 ? 0xff1e42 : 0xf97316;
        const beaconMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 0.95,
          roughness: 0.15,
          metalness: 0.8,
        });
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
        beaconMesh.position.set(m.normX, peakY + 0.45, m.normZ);
        beaconMesh.layers.enable(1);

        beaconMesh.userData = {
          title: `${m.tag} ($${Math.round(m.price).toLocaleString()})`,
          priceLevel: `$${m.price.toFixed(1)} (${
            m.price >= spot ? '+' : ''
          }${(((m.price - spot) / spot) * 100).toFixed(2)}%)`,
          totalLiqUsd: `$${m.usdPoolM.toFixed(2)}M USD`,
          leverageTier: m.leverageLabel,
          magnetPullPct: `${Math.round(m.intensity * 100)}% Gravity Pull`,
          sideLabel: m.isShortSqueeze
            ? 'Short Liquidation Magnet (Upward Pull)'
            : 'Long Liquidation Magnet (Downward Pull)',
          accentColor: m.intensity >= 0.75 ? '#ef4444' : '#f97316',
        } satisfies HoveredMagnetPeak;

        magnetPeaksGroup.add(beaconMesh);

        // Horizontal Target Halo Ring around the Peak
        const ringGeo = new THREE.TorusGeometry(0.68, 0.035, 10, 32);
        ringGeo.rotateX(Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: m.intensity >= 0.75 ? 0xef4444 : 0xfacc15,
          transparent: true,
          opacity: 0.85,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(m.normX, peakY + 0.15, m.normZ);
        magnetPeaksGroup.add(ringMesh);
      });
    };

    rebuildMagnetClustersAndBeacons();

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
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Pre-allocated THREE.Color for zero GC inside render loop
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

      if (elapsed - lastRebuildTime > 0.8) {
        lastRebuildTime = elapsed;
        rebuildMagnetClustersAndBeacons();
      }

      const {
        topoElevationGain: curGain,
        showContourWireframe: showWire,
      } = latestRef.current;

      contourWireMesh.visible = showWire;

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

        // Subtle quantum harmonic pulse on high-density magnet peaks
        const pulse =
          liqDensity > 0.55
            ? Math.sin(elapsed * 2.6 + vx * 0.5) * 0.045 * liqDensity
            : 0;
        const normVal = Math.max(0, Math.min(1, liqDensity + pulse));

        // Elevation Y proportional to USD Liquidation size
        const elevY = Math.pow(normVal, 1.35) * 4.8 * curGain;
        posAttr.setY(i, elevY);

        // Blue-to-Red gradient color lookup
        const cssHex = d3BlueToRedScale(normVal);
        _tmpColor.set(cssHex);
        colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      terrainGeo.computeVertexNormals();

      // 2. Rotate Magnet Peak Beacons
      for (let i = 0; i < magnetPeaksGroup.children.length; i++) {
        const obj = magnetPeaksGroup.children[i];
        obj.rotation.y += dt * 1.1;
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
    <div className="relative w-full h-full min-h-[480px] bg-[#060911] overflow-hidden select-none border border-slate-800/80 rounded-xl shadow-2xl">
      {/* Isolated WebGL Mount Container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Glass-Morphism Telemetry Header */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1.5 bg-[#090D16]/85 backdrop-blur-md border border-slate-800 px-3.5 py-2.5 rounded-lg max-w-xl">
        <div className="flex items-center gap-2 text-xs font-bold text-white font-display">
          <Mountain className="w-4 h-4 text-rose-400" />
          <span>
            3D Quantum Risk Heatmap // Orderbook Liquidation Topography & Price Action Magnets
          </span>
        </div>

        <div className="text-[11px] text-slate-300 font-mono tabular-nums">
          Primary Magnet U(p):{' '}
          <strong className="text-rose-400">
            ${quant.primaryMagnetPrice.toLocaleString()}
          </strong>{' '}
          · Short Squeeze Fuel (+1.5%):{' '}
          <strong className="text-amber-300">
            ${(quant.shortSqueezeFuelUsd / 1e6).toFixed(2)}M
          </strong>{' '}
          · Long Cascade Fuel (-1.5%):{' '}
          <strong className="text-cyan-300">
            ${(quant.longCascadeFuelUsd / 1e6).toFixed(2)}M
          </strong>
        </div>

        {/* Blue-to-Red Color Scale Legend Bar */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 pt-0.5">
          <span className="text-blue-400">Low Liq ($0.5M)</span>
          <div className="w-36 h-2 rounded-xs bg-gradient-to-r from-blue-900 via-sky-500 via-amber-500 to-rose-600 border border-slate-700/60" />
          <span className="text-rose-400 font-semibold">
            Magnet Peak ($25M+ USD)
          </span>
        </div>
      </div>

      {/* Top-Right Action Buttons */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {onTriggerMagnetSignal && (
          <button
            type="button"
            onClick={() => {
              const isUpMagnet = quant.primaryMagnetPrice >= currentPrice;
              onTriggerMagnetSignal(
                isUpMagnet ? 'LONG' : 'SHORT',
                isUpMagnet
                  ? `QUANTUM RISK MAGNET LONG // TARGET PEAK $${quant.primaryMagnetPrice}`
                  : `QUANTUM RISK MAGNET SHORT // TARGET PEAK $${quant.primaryMagnetPrice}`,
                `3D Quantum Risk Topographic Heatmap identified an extreme crimson liquidation magnet peak at $${quant.primaryMagnetPrice} (Short Squeeze Fuel: $${(
                  quant.shortSqueezeFuelUsd / 1e6
                ).toFixed(2)}M vs Long Cascade Fuel: $${(
                  quant.longCascadeFuelUsd / 1e6
                ).toFixed(2)}M).`
              );
            }}
            className="px-2.5 py-1.5 text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Magnet Sweep Signal</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => applyPreset('iso')}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Reset Map</span>
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

      {/* Raycasted Magnet Peak Hover Card */}
      {hoveredPeak && (
        <div className="absolute top-28 left-3 z-10 pointer-events-none bg-[#090D16]/95 border border-rose-500/50 px-3.5 py-2.5 rounded-lg shadow-2xl max-w-xs font-mono text-xs">
          <div className="font-sans font-bold text-white flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span>{hoveredPeak.title}</span>
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5">
            {hoveredPeak.sideLabel}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-800 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <span className="text-slate-500 block">Price Level</span>
              <span className="text-white font-semibold">
                {hoveredPeak.priceLevel}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Total Liq Pool</span>
              <span className="text-rose-400 font-bold">
                {hoveredPeak.totalLiqUsd}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Leverage Cluster</span>
              <span className="text-amber-300">{hoveredPeak.leverageTier}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Magnet Gravity</span>
              <span className="text-cyan-300 font-semibold">
                {hoveredPeak.magnetPullPct}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 max-w-[calc(100%-24px)] w-auto flex flex-col items-center">
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
              <span>Pokaż kontrolki 3D Quantum Risk</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>Ukryj kontrolki</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="bg-[#0B101B]/95 backdrop-blur-md border border-slate-800 rounded-b-lg rounded-tl-lg px-3.5 py-2.5 shadow-2xl flex flex-wrap items-center justify-center gap-2.5 max-w-full">
            {/* Camera Presets */}
            <div className="flex items-center gap-1 bg-[#070A12] p-1 rounded-md border border-slate-800/80">
              <Camera className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 shrink-0" />
              {(
                [
                  { id: 'iso', label: 'Topographic Iso' },
                  { id: 'shortsqueeze', label: 'Short Squeeze' },
                  { id: 'longcascade', label: 'Long Cascade' },
                  { id: 'topcontour', label: 'Top-Down Contour' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    preset === item.id
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Elevation & Bokeh DOF Sliders */}
            <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
              <label className="flex items-center gap-1 text-slate-300 whitespace-nowrap">
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-slate-400">Wysokość:</span>
                <input
                  type="range"
                  min={0.6}
                  max={2.2}
                  step={0.05}
                  value={topoElevationGain}
                  onChange={(e) => setTopoElevationGain(Number(e.target.value))}
                  className="w-14 accent-rose-500 cursor-pointer"
                />
                <span className="font-mono text-rose-300 w-8">
                  {topoElevationGain.toFixed(2)}x
                </span>
              </label>

              <button
                type="button"
                onClick={() => setShowContourWireframe((v) => !v)}
                className={`px-2 py-1 rounded font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  showContourWireframe
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800'
                }`}
              >
                Iso: {showContourWireframe ? 'ON' : 'OFF'}
              </button>

              <button
                type="button"
                onClick={() => setDofEnabled((v) => !v)}
                className={`px-2 py-1 rounded font-medium flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 ${
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
                  min={10}
                  max={40}
                  step={1}
                  value={dofFocus}
                  onChange={(e) => setDofFocus(Number(e.target.value))}
                  className="w-12 accent-cyan-400 cursor-pointer"
                />
                <span className="font-mono text-cyan-300 w-6">{dofFocus}m</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
