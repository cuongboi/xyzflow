import { OrbitControls } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { Flow3D, useCreateFlow } from "xyzflow"

import { demoGraph } from "@/examples/playground/demo"
import { nodeTypes } from "@/examples/playground/nodes"

/** Small live editor shown on the landing page (same graph as the playground). */
export default function HeroScene() {
  const flow = useCreateFlow({ snap: 0.5, initial: demoGraph() })
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ position: [10, 9, 13], fov: 45 }}>
      <hemisphereLight args={["#c8d6ff", "#1a1d26", 1.1]} />
      <directionalLight position={[8, 14, 6]} intensity={1.4} />
      <OrbitControls makeDefault enableZoom={false} />
      <Flow3D flow={flow} nodeTypes={nodeTypes} />
    </Canvas>
  )
}
