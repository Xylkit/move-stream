import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/demo")({
  component: CookbookComponent,
});

function CookbookComponent() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8">Cookbook</h1>
      <p className="text-muted-foreground">Coming soon...</p>
    </div>
  );
}
