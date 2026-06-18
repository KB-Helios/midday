import { createTRPCRouter, protectedProcedure } from "@api/trpc/init";
import { getOverviewSummary } from "@midday/db/queries";
import {
  getLocalOverviewSummary,
  getSeededLocalDb,
} from "@midday/db/local-queries";
import { isLocalDesktopRuntime } from "@midday/utils/envs";

export const overviewRouter = createTRPCRouter({
  summary: protectedProcedure.query(async ({ ctx: { db, teamId } }) => {
    if (isLocalDesktopRuntime()) {
      return getLocalOverviewSummary(getSeededLocalDb(), { teamId: teamId! });
    }

    return getOverviewSummary(db, { teamId: teamId! });
  }),
});
