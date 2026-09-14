"use client";

import { Button } from "@/components/ui/button";

export default function ReviewError({ reset }: { reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Couldn’t load reviews</h1>
      <p role="alert">
        Something went wrong while loading this review. Please try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
