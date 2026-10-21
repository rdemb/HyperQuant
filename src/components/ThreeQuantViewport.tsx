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
  Eye,
  Focus,
  Layers,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import {
  L2OrderbookLevel,
  LiquidationHeatmapCell,
  OHLCVBar,
  QuantMathMetrics,
  ShaakuniState,
} from '../types/trading';

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

type CameraPreset = 'isometric' | 'canyon' | 'neural' | 'topdown';

interface HoveredTensorNode {
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
  accentColor: string;
}

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
  const [dofEnabled, setDofEnabled] = useState<boolean>(true);
  const [dofFocus, setDofFocus] = useState<number>(26);
  const [dofAperture, setDofAperture] = useState<number>(1.8); // x 0.0001
  const [explodedScale, setExplodedScale] = useState<number>(1.0);
  const [showOBVolumes, setShowOBVolumes] = useState<boolean>(true);
  const [showNeuralSurface, setShowNeuralSurface] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
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
    } else if (preset === 'neural') {
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
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070a12);
    scene.fog = new THREE.FogExp2(0x070a12, 0.015);

    // 2. Mandatory Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 160);
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
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x090d16, 0.85);
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

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 1.45);
    rimLight.position.set(-20, 14, -16);
    scene.add(rimLight);

    // 4. Grounding Platform & Procedural Precision Coordinate Grid
    const platformGroup = new THREE.Group();
    scene.add(platformGroup);

    const basePlateGeo = new THREE.BoxGeometry(36, 0.3, 22);
    const basePlateMat = new THREE.MeshStandardMaterial({
      color: 0x0b101d,
      roughness: 0.35,
      metalness: 0.75,
    });
    const basePlate = new THREE.Mesh(basePlateGeo, basePlateMat);
    basePlate.position.set(0, -4.2, 0);
    basePlate.receiveShadow = true;
    platformGroup.add(basePlate);

    const gridHelper = new THREE.GridHelper(34, 34, 0x1e293b, 0x111827);
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
    const bullCandleMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.22,
      roughness: 0.22,
      metalness: 0.78,
    });
    const bearCandleMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xbe123c,
      emissiveIntensity: 0.22,
      roughness: 0.48,
      metalness: 0.52,
    });
    const wickMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.3,
      metalness: 0.85,
    });

    const bullOBGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x2979ff,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.25,
      roughness: 0.15,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.82,
      transparent: true,
      opacity: isSoftwareGl ? 0.38 : 0.88,
      ior: 1.52,
      thickness: 1.2,
      depthWrite: false,
    });

    const bearOBGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xff7043,
      emissive: 0xc2410c,
      emissiveIntensity: 0.25,
      roughness: 0.15,
      metalness: 0.1,
      transmission: isSoftwareGl ? 0 : 0.82,
      transparent: true,
      opacity: isSoftwareGl ? 0.38 : 0.88,
      ior: 1.52,
      thickness: 1.2,
      depthWrite: false,
    });

    const bidWallMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.2,
      roughness: 0.28,
      metalness: 0.72,
    });

    const askWallMat = new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 0.2,
      roughness: 0.28,
      metalness: 0.72,
    });

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
          title: `BTC-PERP Bar #${idx + 1}`,
          subtitle: `${new Date(b.time).toLocaleTimeString()} · Close $${b.close.toFixed(1)}`,
          metricLabel: 'Net Perp/Spot Delta',
          metricValue: `${b.vbuy - b.vsell >= 0 ? '+' : ''}$${((b.vbuy - b.vsell) / 1000).toFixed(0)}K`,
          accentColor: isBull ? '#38bdf8' : '#f43f5e',
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
          color: 0xfbbf24,
          emissive: 0xd97706,
          emissiveIntensity: 0.45,
          roughness: 0.2,
          metalness: 0.8,
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
            title: `Shaakuni ${ob.type === 'bull' ? 'Bullish' : 'Bearish'} ${ob.label}`,
            subtitle: `Range: $${ob.bottom.toFixed(1)} – $${ob.top.toFixed(1)}`,
            metricLabel: 'Impulse Multiple',
            metricValue: `${ob.impulseAtrMultiple}x ATR · Unmitigated`,
            accentColor: ob.type === 'bull' ? '#2979ff' : '#ff7043',
          };
          orderBlocksGroup.add(obMesh);

          // Wireframe metallic trim around the Order Block
          const edgesGeo = new THREE.EdgesGeometry(obGeo);
          const edgesMat = new THREE.LineBasicMaterial({
            color: ob.type === 'bull' ? 0x60a5fa : 0xfb923c,
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
          label: 'PDH (Prev Day High)',
          price: curShaakuni.pdh,
          color: 0xff8c00,
          hex: '#ff8c00',
          status: curShaakuni.pdhStatus,
        },
        {
          label: 'PDL (Prev Day Low)',
          price: curShaakuni.pdl,
          color: 0x0096c8,
          hex: '#0096c8',
          status: curShaakuni.pdlStatus,
        },
        {
          label: 'D-EQ (Daily 50%)',
          price: curShaakuni.deq,
          color: 0x00e5ff,
          hex: '#00e5ff',
        },
        {
          label: 'W-EQ (Weekly 50%)',
          price: curShaakuni.weq,
          color: 0xffd700,
          hex: '#ffd700',
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
          emissiveIntensity: 0.65,
          roughness: 0.2,
          metalness: 0.8,
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.set(0, y, -0.5);
        beamMesh.layers.enable(1);
        beamMesh.userData = {
          title: `Shaakuni ${lvl.label}`,
          subtitle: `Price Level: $${lvl.price.toFixed(1)}`,
          metricLabel: 'Liquidity Status',
          metricValue: lvl.status ?? 'Equilibrium Magnet',
          accentColor: lvl.hex,
        };
        levelsGroup.add(beamMesh);
      });

      // 4. AggrBTCv5 Liquidation Heatmap Towers (5x, 20x, 100x Leverage Clusters)
      curHeatmap.slice(0, 14).forEach((cell) => {
        const y = priceToY(cell.priceLevel);
        if (y < -3.8 || y > 4.8) return;

        const lengthX = 0.8 + cell.intensityRatio * 3.8;
        const barGeo = new THREE.BoxGeometry(lengthX, 0.16, 0.42);
        const colHex =
          cell.intensityRatio > 0.72
            ? 0xf0da18
            : cell.intensityRatio > 0.45
            ? 0x4c9886
            : 0x26828c;
        const barMat = new THREE.MeshStandardMaterial({
          color: colHex,
          emissive: colHex,
          emissiveIntensity: 0.35 + cell.intensityRatio * 0.4,
          roughness: 0.2,
          metalness: 0.6,
        });
        const barMesh = new THREE.Mesh(barGeo, barMat);
        barMesh.position.set(
          startX + sliceCount * stepX + 1.2 + lengthX / 2,
          y,
          -2.8 * expScale
        );
        barMesh.layers.enable(1);
        barMesh.userData = {
          title: `Aggr Liquidation Cluster (${cell.leverage}x)`,
          subtitle: `Zone: $${cell.bottom.toFixed(0)} – $${cell.top.toFixed(0)}`,
          metricLabel: 'Cluster Strength',
          metricValue: `${(cell.intensityRatio * 100).toFixed(0)}% Intensity (${cell.count} hits)`,
          accentColor: '#f0da18',
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
          title: `Hyperliquid + Aggr L2 Bid Wall`,
          subtitle: `Price: $${bid.price.toFixed(1)} (${bid.exchangeCount} venues)`,
          metricLabel: 'Resting Bid Depth',
          metricValue: `$${(bid.sizeUsd / 1000).toFixed(1)}K (${bid.sizeBtc} BTC)`,
          accentColor: '#10b981',
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
          title: `Hyperliquid + Aggr L2 Ask Wall`,
          subtitle: `Price: $${ask.price.toFixed(1)} (${ask.exchangeCount} venues)`,
          metricLabel: 'Resting Ask Depth',
          metricValue: `$${(ask.sizeUsd / 1000).toFixed(1)}K (${ask.sizeBtc} BTC)`,
          accentColor: '#f43f5e',
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
          const colHex = bucket.isPOC
            ? 0xfacc15
            : bucket.gravityPotential > 0.75
            ? 0x22d3ee
            : bucket.isValueArea
            ? 0x3b82f6
            : 0x334155;
          const profMat = new THREE.MeshStandardMaterial({
            color: colHex,
            emissive: colHex,
            emissiveIntensity: bucket.isPOC ? 0.65 : 0.28,
            roughness: 0.25,
            metalness: 0.75,
          });
          const profMesh = new THREE.Mesh(profGeo, profMat);
          profMesh.position.set(
            startX - 1.2 - lengthX / 2,
            y,
            1.6 * expScale
          );
          profMesh.layers.enable(1);
          profMesh.userData = {
            title: bucket.isPOC
              ? `Volume Profile POC ($${bucket.price})`
              : `Liquidity Profile Bucket ($${bucket.price})`,
            subtitle: `Vol: $${(bucket.totalVolumeUsd / 1000000).toFixed(2)}M · Liq Fuel: $${(
              bucket.liquidationPoolUsd / 1000000
            ).toFixed(2)}M`,
            metricLabel: 'Gravitational Pull U(p)',
            metricValue: `${(bucket.gravityPotential * 100).toFixed(0)}% Magnet Strength`,
            accentColor: bucket.isPOC ? '#facc15' : '#22d3ee',
          };
          l2CanyonGroup.add(profMesh);
        });
      }

      // 6. 3D Neural Time-Series Prediction Cone & Attention Tensor Nodes
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
            color: isBullForecast ? 0x10b981 : 0xf43f5e,
            emissive: isBullForecast ? 0x059669 : 0xe11d48,
            emissiveIntensity: 0.6,
            roughness: 0.2,
            metalness: 0.8,
          });
          const ringMesh = new THREE.Mesh(ringGeo, ringMat);
          ringMesh.position.set(fx, fy, 0);
          ringMesh.layers.enable(1);
          ringMesh.userData = {
            title: `Neural Forecast Horizon (${fh.label})`,
            subtitle: `1σ Band: $${fh.lower1Sigma.toFixed(0)} – $${fh.upper1Sigma.toFixed(0)}`,
            metricLabel: 'Predicted BTC Price',
            metricValue: `$${fh.predictedPrice.toFixed(1)} (${curQuant.neuralConfidence}% Conf)`,
            accentColor: isBullForecast ? '#10b981' : '#f43f5e',
          };
          neuralSurfaceGroup.add(ringMesh);
        });

        const fCurve = new THREE.CatmullRomCurve3(pts);
        const fTubeGeo = new THREE.TubeGeometry(fCurve, 32, 0.09, 12, false);
        const fTubeMat = new THREE.MeshStandardMaterial({
          color: curQuant.neuralDirectionBias >= 0 ? 0x34d399 : 0xfb7185,
          emissive: curQuant.neuralDirectionBias >= 0 ? 0x10b981 : 0xf43f5e,
          emissiveIntensity: 0.8,
          roughness: 0.15,
          metalness: 0.85,
        });
        const fTube = new THREE.Mesh(fTubeGeo, fTubeMat);
        neuralSurfaceGroup.add(fTube);
      }
    };

    rebuildMarketScene();

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
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Animation loop with IntersectionObserver visibility guard & Software WebGL fenceSync pacing
    let startTimeMs = performance.now();
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
      const delta = Math.min(0.1, (nowMs - prevTimeMs) / 1000);
      prevTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (!isVisible) {
        frameId = window.setTimeout(tick, 250);
        return;
      }

      // Rebuild 3D geometry periodically as new live trades arrive
      if (elapsed - lastSceneBuildTick > 0.45) {
        lastSceneBuildTick = elapsed;
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

      // Update BokehPass Depth of Field uniforms dynamically
      if (bokehPass && composer) {
        const uniforms = bokehPass.uniforms as Record<string, { value: number }>;
        if (uniforms['focus']) {
          uniforms['focus'].value = latestDataRef.current.dofFocus;
        }
        if (uniforms['aperture']) {
          uniforms['aperture'].value = latestDataRef.current.dofEnabled
            ? latestDataRef.current.dofAperture * 0.0001
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
    <div className="relative w-full h-full min-h-[360px] bg-[#070A12] overflow-hidden select-none border border-slate-800/80 rounded-lg">
      {/* Dedicated WebGL Mount Container */}
      <div ref={canvasMountRef} className="w-full h-full" />

      {/* Top-Left Minimal Spec Header (No backdrop-filter over WebGL per Three.js skill) */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-1 bg-[#090D16]/90 border border-slate-800 px-3 py-2 rounded-md">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
          <span>3D Liquidity, Order Block & Neural Tensor</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono text-cyan-400">Bokeh DOF Engine</span>
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          L2 Micro-Price: ${quant.l2MicroPrice.toFixed(1)} · OB Imbalance:{' '}
          {(quant.l2OrderbookImbalance * 100).toFixed(1)}% · Hurst H={quant.hurstExponent}
        </div>
      </div>

      {/* Top-Right Expand / Reset Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => applyCameraPreset('isometric')}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-800 rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          title="Reset Camera"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Reset Orbit</span>
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

      {/* Raycasted 3D Object Hover Inspection Card */}
      {hoveredNode && (
        <div className="absolute top-16 left-3 z-10 pointer-events-none bg-[#090D16]/95 border border-slate-700 px-3.5 py-2.5 rounded-md shadow-xl max-w-xs">
          <div className="text-xs font-semibold text-white flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-xs"
              style={{ backgroundColor: hoveredNode.accentColor }}
            />
            <span>{hoveredNode.title}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
            {hoveredNode.subtitle}
          </div>
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-4 text-[11px] font-mono">
            <span className="text-slate-400">{hoveredNode.metricLabel}</span>
            <span className="text-cyan-300 font-semibold">{hoveredNode.metricValue}</span>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock (Mandatory Three.js Skill Layout) */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 transition-transform duration-200"
        style={{
          maxWidth: 'min(920px, 95%)',
          width: '100%',
          transform: dockCollapsed
            ? 'translate(-50%, calc(100% - 28px))'
            : 'translate(-50%, 0)',
        }}
      >
        {/* Collapse / Expand Toggle Handle */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="px-3 py-1 text-[11px] font-medium text-slate-300 bg-[#0B101B] hover:bg-slate-800 border border-b-0 border-slate-800 rounded-t-md flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Show 3D & Depth-of-Field Controls</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                <span>Hide Controls</span>
              </>
            )}
          </button>
        </div>

        {/* Main Dock Body (Solid dark surface without backdrop-filter to prevent WebGL stall) */}
        <div className="bg-[#0B101B]/95 border border-slate-800 rounded-lg px-3.5 py-2.5 shadow-2xl flex flex-wrap items-center justify-between gap-3">
          {/* Camera Presets */}
          <div className="flex items-center gap-1 bg-[#070A12] p-1 rounded-md border border-slate-800/80">
            <Camera className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-1 shrink-0" />
            {(
              [
                { id: 'isometric', label: 'Isometric' },
                { id: 'canyon', label: 'L2 & OB Canyon' },
                { id: 'neural', label: 'Neural Cone' },
                { id: 'topdown', label: 'Top Liquidity' },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyCameraPreset(preset.id)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  cameraPreset === preset.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Bokeh Depth of Field (DOF) Sliders */}
          <div className="flex items-center gap-3 text-[11px]">
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
              <span>Bokeh DOF: {dofEnabled ? 'ON' : 'OFF'}</span>
            </button>

            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <span className="text-slate-400">Focus:</span>
              <input
                type="range"
                min={8}
                max={48}
                step={1}
                value={dofFocus}
                onChange={(e) => setDofFocus(Number(e.target.value))}
                className="w-16 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-cyan-300 w-7">{dofFocus}m</span>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <span className="text-slate-400">Aperture:</span>
              <input
                type="range"
                min={0.4}
                max={4.5}
                step={0.2}
                value={dofAperture}
                onChange={(e) => setDofAperture(Number(e.target.value))}
                className="w-16 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-cyan-300 w-8">f/{dofAperture.toFixed(1)}</span>
            </label>
          </div>

          {/* Exploded Z-Separation & Layer Toggles */}
          <div className="flex items-center gap-2.5 text-[11px]">
            <label className="flex items-center gap-1.5 text-slate-300 whitespace-nowrap">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400">Z-Spread:</span>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={explodedScale}
                onChange={(e) => setExplodedScale(Number(e.target.value))}
                className="w-14 accent-cyan-400 cursor-pointer"
              />
            </label>

            <button
              type="button"
              onClick={() => setShowOBVolumes((v) => !v)}
              className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                showOBVolumes
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>3D OBs</span>
            </button>

            <button
              type="button"
              onClick={() => setShowNeuralSurface((v) => !v)}
              className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                showNeuralSurface
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Neural Cone</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
