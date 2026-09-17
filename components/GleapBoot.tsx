// SQEM-261 — starts Gleap once, for a signed-in person, and renders nothing.
//
// It is a component rather than a call in `App.tsx` so it can sit **inside** the authenticated tree:
// the public listing page renders its own routes without ever mounting this, which is what keeps a
// third-party widget away from a stranger who followed a shared link (SQEM-258).

import { useEffect } from 'react';
import { useWorkspace } from '../store';
import { startGleap } from '../lib/gleap';

const GleapBoot = () => {
  const { workspace, currentUser } = useWorkspace();

  useEffect(() => {
    // ⚠️ Both can be empty for a moment while the session loads. Identifying a half-loaded user would
    // create a Gleap contact with no name and no workspace, and it is not repairable afterwards.
    if (!currentUser?.id || !workspace?.id) return;
    startGleap(currentUser, workspace);
  }, [currentUser, workspace]);

  return null;
};

export default GleapBoot;
