import { Billboard, RoundedBox, Text } from '@react-three/drei'
import { customNode, instancedNode, type CustomNodeProps, type NodeTypes } from 'xyzflow'
import { BoxGeometry, IcosahedronGeometry, OctahedronGeometry } from 'three'

export interface CardData {
  label: string
}

/** Custom node: any R3F tree. Rendered per node, so use for the "rich" minority. */
function CardNode({ data, selected, hovered }: CustomNodeProps<CardData>) {
  const color = selected ? '#ffb020' : hovered ? '#5b78c7' : '#34446a'
  return (
    <Billboard>
      <RoundedBox args={[1.8, 0.8, 0.16]} radius={0.08} smoothness={3}>
        <meshStandardMaterial color={color} roughness={0.6} />
      </RoundedBox>
      <Text position={[0, 0, 0.09]} fontSize={0.24} color="#ffffff" anchorX="center" anchorY="middle">
        {data.label}
      </Text>
    </Billboard>
  )
}

/** Module scope: node types must be referentially stable. */
export const nodeTypes: NodeTypes = {
  // instanced = 1 draw call per type, scales to 100k+
  default: instancedNode({ geometry: new BoxGeometry(0.8, 0.8, 0.8), radius: 0.55 }),
  sphere: instancedNode({ geometry: new IcosahedronGeometry(0.45, 2), radius: 0.45 }),
  gem: instancedNode({ geometry: new OctahedronGeometry(0.5), radius: 0.5 }),
  card: customNode<CardData>(CardNode, { radius: 0.9 }),
}

export const palette = [0x6c8cff, 0x4fd1c5, 0xf6ad55, 0xf56565, 0xb794f4, 0x68d391]
