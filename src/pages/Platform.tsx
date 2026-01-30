/**
 * Platform Page - Main entry point for /platform routes
 * 
 * Human Services Coordination Layer - Frontend prototype
 */

import { Routes, Route, Navigate } from "react-router-dom";
import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { PlatformOverview } from "@/components/platform/PlatformOverview";
import { PlatformCases } from "@/components/platform/PlatformCases";
import { PlatformReferrals } from "@/components/platform/PlatformReferrals";
import { PlatformProviders } from "@/components/platform/PlatformProviders";
import { PlatformDocuments } from "@/components/platform/PlatformDocuments";
import { PlatformEvents } from "@/components/platform/PlatformEvents";
import { PlatformProgress } from "@/components/platform/PlatformProgress";

export default function Platform() {
  return (
    <PlatformLayout>
      <Routes>
        <Route index element={<PlatformOverview />} />
        <Route path="cases" element={<PlatformCases />} />
        <Route path="referrals" element={<PlatformReferrals />} />
        <Route path="providers" element={<PlatformProviders />} />
        <Route path="documents" element={<PlatformDocuments />} />
        <Route path="events" element={<PlatformEvents />} />
        <Route path="progress" element={<PlatformProgress />} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Routes>
    </PlatformLayout>
  );
}
