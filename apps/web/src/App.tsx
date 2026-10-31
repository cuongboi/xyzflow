import { lazy, Suspense } from "react"
import { Link, Route, Routes } from "react-router"

import { HomePage } from "@/pages/home"
import { Spinner } from "@/components/ui/spinner"

// three.js + the demos only load when an example route is opened
const PlaygroundExample = lazy(() => import("@/examples/playground/App"))
const PcbExample = lazy(() => import("@/examples/pcb/App"))

function ExampleShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense
        fallback={
          <div className="flex h-svh items-center justify-center bg-[#0d1016] text-white">
            <Spinner />
          </div>
        }
      >
        {children}
      </Suspense>
      <Link
        to="/"
        className="fixed right-3 bottom-3 z-50 rounded-md border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-black/80"
      >
        ← xyzflow home
      </Link>
    </>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/examples/playground"
        element={
          <ExampleShell>
            <PlaygroundExample />
          </ExampleShell>
        }
      />
      <Route
        path="/examples/pcb"
        element={
          <ExampleShell>
            <PcbExample />
          </ExampleShell>
        }
      />
      <Route path="*" element={<HomePage />} />
    </Routes>
  )
}

export default App
