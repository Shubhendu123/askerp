import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          AskERP
        </h1>
        <p className="mt-4 text-xl text-muted-foreground max-w-xl">
          Conversational analytics for Northwind Furniture — ask questions, get answers.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Built with Next.js, DuckDB, and Claude. Powered by natural language.
        </p>
        <Button className="mt-8" disabled>
          Start chatting
        </Button>
      </main>

      <footer className="py-6 px-4">
        <Separator className="mb-6" />
        <p className="text-center text-sm text-muted-foreground">
          A portfolio project by Shubhendu{" "}
          <span className="mx-1">|</span>{" "}
          <a
            href="https://github.com/Shubhendu123"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
