/**
 * Retrieve Page - Source-backed retrieval and research workspace
 * 
 * Citation-first, non-opinionated research surface for caseworkers
 * to find trustworthy information from the knowledge base.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Search, FileText, Quote, BookOpen, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

const EXAMPLE_QUERIES = [
  {
    label: "Understand a notice or letter",
    description: "Paste text from a document a client brought in",
    icon: FileText,
  },
  {
    label: "Look up a policy or statute",
    description: "Search for specific rules, requirements, or procedures",
    icon: BookOpen,
  },
  {
    label: "Find relevant guidance materials",
    description: "Retrieve handbook sections, regulations, or standards",
    icon: Quote,
  },
];

export default function Retrieve() {
  const [query, setQuery] = useState("");

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-start pt-12 pb-16 px-4 min-h-full">
        {/* Page header */}
        <div className="text-center max-w-2xl mb-10">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">
            Retrieve
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            Search trusted sources for source-backed answers with citations.
            Paste text from a notice, letter, or form — or ask a grounded question.
          </p>
        </div>

        {/* Primary input area */}
        <div className="w-full max-w-2xl mb-10">
          <div className="relative rounded-xl border border-border bg-card shadow-sm">
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste text from a document, or describe what you're looking for…"
              className="min-h-[120px] resize-none border-0 bg-transparent px-5 pt-5 pb-14 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Retrieve search input"
            />
            <div className="absolute bottom-3 right-3">
              <Button
                size="sm"
                disabled={!query.trim()}
                className="gap-2"
                aria-label="Search trusted sources"
              >
                <Search className="h-4 w-4" />
                Search sources
              </Button>
            </div>
          </div>
        </div>

        {/* Trust callout */}
        <div className="w-full max-w-2xl mb-10">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-5 py-4">
            <Quote className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                Every answer is grounded in your knowledge base
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Results are drawn directly from uploaded policies, statutes, and guidance materials.
                All responses include source citations so you can verify the information.
              </p>
            </div>
          </div>
        </div>

        {/* Example queries */}
        <div className="w-full max-w-2xl">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Ways to use Retrieve
          </p>
          <div className="grid gap-3">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example.label}
                className="flex items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-secondary/50 group"
                onClick={() => setQuery(example.description)}
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                  <example.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {example.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {example.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
