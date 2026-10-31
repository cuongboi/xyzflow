// Core (framework-agnostic; also available as `xyzflow/core`)
export * from './core'

// React / R3F renderer
export { Flow3D, type Flow3DProps } from './react/Flow3D'
export type { InteractionOptions } from './react/Interaction'
export {
  instancedNode,
  customNode,
  getDefaultNodeTypes,
  getHandleTable,
  boxHandles,
  type HandleDef,
  type NodeType,
  type NodeTypes,
  type InstancedNodeType,
  type CustomNodeType,
  type CustomNodeProps,
} from './react/node-types'
export { useFlow, useFlowContext, type FlowRenderContext } from './react/context'
export { useCreateFlow, useFlowState, shallowEqual } from './react/hooks'
export { defaultTheme, type Flow3DTheme } from './react/theme'
export type { EdgeStyle, TubeShape, EdgeDefaults } from './react/curve'
export { EdgesLayer, EdgeTubesLayer, ConnectionPreview } from './react/EdgesLayer'
export { HandlesLayer, type ActiveHandle } from './react/HandlesLayer'
