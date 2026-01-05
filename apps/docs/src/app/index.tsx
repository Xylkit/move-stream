import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="flex items-center justify-center min-h-screen w-full">
      <div className="text-center">
        <h1 className="text-4xl md:text-6xl font-bold mb-4">
          Home of Streams
        </h1>
        <p className="text-xl md:text-2xl text-muted-foreground">
          Xylkit
        </p>
      </div>
    </div>
  );
}
