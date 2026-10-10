import { createFileRoute } from "@tanstack/react-router";
import { WaffleApp } from "@/components/waffle-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WaffleApp />;
}
