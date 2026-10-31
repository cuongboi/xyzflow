import { lazy, Suspense } from "react"
import { Link } from "react-router"
import {
  BoxesIcon,
  CpuIcon,
  FileJsonIcon,
  GitBranchIcon,
  MoonIcon,
  MousePointerClickIcon,
  SunIcon,
  Undo2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants, Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block"
import { Spinner } from "@/components/ui/spinner"
import { useTheme } from "@/components/theme-provider"

const HeroScene = lazy(() => import("./hero-scene"))

const INSTALL = "npm i z-flow three @react-three/fiber @react-three/drei"

const QUICK_START = `import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Flow3D, useCreateFlow } from 'z-flow'

export function Editor() {
  const flow = useCreateFlow({ snap: 0.5 })
  return (
    <>
      <button onClick={() => flow.addNode({ position: { x: 0, y: 0.5, z: 0 } })}>
        Add
      </button>
      <Canvas frameloop="demand" camera={{ position: [8, 8, 8] }}>
        <ambientLight />
        <directionalLight position={[5, 10, 5]} />
        <OrbitControls makeDefault />
        <Flow3D flow={flow} />
      </Canvas>
    </>
  )
}`

const FEATURES = [
  {
    icon: MousePointerClickIcon,
    title: "React Flow ergonomics",
    text: "Nodes, edges, connect, select, box-select, copy/paste — familiar APIs with { x, y, z } positions.",
  },
  {
    icon: BoxesIcon,
    title: "Instanced rendering",
    text: "GPU-instanced node types draw 10k–100k+ nodes in one call per type. Use any R3F component for the rest.",
  },
  {
    icon: CpuIcon,
    title: "Typed-array core",
    text: "A framework-agnostic store, also shipped as z-flow/core for workers, Node or other renderers.",
  },
  {
    icon: Undo2Icon,
    title: "Undo / redo built in",
    text: "Every add, move, connect and delete is a history entry; bulk loads can opt out.",
  },
  {
    icon: FileJsonIcon,
    title: "Serializable",
    text: "flow.toJSON() / flow.fromJSON() round-trip the whole graph, including rotation and edge handles.",
  },
  {
    icon: GitBranchIcon,
    title: "Validated connections",
    text: "No self-loops or duplicates, plus your own isValidConnection rule for domain logic.",
  },
]

const EXAMPLES = [
  {
    to: "/examples/playground",
    title: "Playground",
    text: "A 3D pipeline editor: add instanced and custom nodes, switch edge styles, and stress-test with thousands of nodes.",
  },
  {
    to: "/examples/pcb",
    title: "PCB editor",
    text: "Place parts on stacked boards and route nets pad-to-pad, with rotation and custom connection rules.",
  },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}

export function HomePage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-6">
          <Link to="/" className="font-semibold tracking-tight">
            z-flow
          </Link>
          <a href="#examples" className="text-sm text-muted-foreground hover:text-foreground">
            Examples
          </a>
          <a href="#quick-start" className="text-sm text-muted-foreground hover:text-foreground">
            Docs
          </a>
          <div className="ms-auto flex items-center gap-1">
            <a
              href="https://www.npmjs.com/package/z-flow"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              npm
            </a>
            <ThemeToggle />
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-16 lg:grid-cols-2 lg:py-24">
          <div className="flex flex-col gap-6">
            <Badge variant="secondary" className="w-fit">
              React Three Fiber · MIT
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              A high-performance 3D node editor for React
            </h1>
            <p className="text-lg text-muted-foreground text-pretty">
              z-flow works like React Flow — nodes, edges, connect, select, undo — but positions are{" "}
              <code className="font-mono text-foreground">{"{ x, y, z }"}</code> and nodes are
              three.js objects. Built on a typed-array core with instanced rendering.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#quick-start" className={buttonVariants({ size: "lg" })}>
                Get started
              </a>
              <Link
                to="/examples/playground"
                className={buttonVariants({ size: "lg", variant: "outline" })}
              >
                Open playground
              </Link>
            </div>
            <CodeBlock size="sm" className="max-w-lg">
              <CodeBlockActions>
                <CodeBlockCopyButton value={INSTALL} />
              </CodeBlockActions>
              <CodeBlockContent>{`$ ${INSTALL}`}</CodeBlockContent>
            </CodeBlock>
          </div>
          <div className="relative aspect-square overflow-hidden rounded-xl border bg-[#0d1016] lg:aspect-[4/3.5]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-white">
                  <Spinner />
                </div>
              }
            >
              <HeroScene />
            </Suspense>
            <span className="pointer-events-none absolute bottom-3 left-3 text-xs text-white/60">
              Live — drag nodes, Alt+drag to connect
            </span>
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="mb-8 text-2xl font-semibold tracking-tight">Why z-flow</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <Card key={title}>
                  <CardHeader>
                    <Icon className="mb-2 size-5 text-muted-foreground" />
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{text}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="quick-start" className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16">
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">Quick start</h2>
          <p className="mb-6 text-muted-foreground">
            Peer dependencies: react ≥ 19, three ≥ 0.170, @react-three/fiber ≥ 9.
          </p>
          <CodeBlock>
            <CodeBlockHeader>
              <CodeBlockTitle>Editor.tsx</CodeBlockTitle>
              <CodeBlockActions>
                <CodeBlockCopyButton value={QUICK_START} />
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent lineNumbers>{QUICK_START}</CodeBlockContent>
          </CodeBlock>
        </section>

        <section id="examples" className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl scroll-mt-16 px-6 py-16">
            <h2 className="mb-8 text-2xl font-semibold tracking-tight">Examples</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {EXAMPLES.map(({ to, title, text }) => (
                <Link key={to} to={to} className="group">
                  <Card className="h-full transition-colors group-hover:border-foreground/30">
                    <CardHeader>
                      <CardTitle>{title} →</CardTitle>
                      <CardDescription>{text}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl justify-between px-6 py-8 text-sm text-muted-foreground">
          <span>z-flow · MIT License</span>
          <a href="https://www.npmjs.com/package/z-flow" className="hover:text-foreground">
            npmjs.com/package/z-flow
          </a>
        </div>
      </footer>
    </div>
  )
}
