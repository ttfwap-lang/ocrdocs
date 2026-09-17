/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The DGX operator scripts shown in the UI are imported directly from the
 * real files under scripts/ via Vite's ?raw loader. They are deliberately NOT
 * copied into string literals here: a copy drifts silently the moment anyone
 * edits the real script, and the UI would then display and hand out code that
 * does not match what actually runs on the DGX.
 */

import DGX_SETUP_SH from '../../scripts/dgx_setup.sh?raw';
import OCR_SPARK_ENGINE_PY from '../../scripts/ocr_spark_engine.py?raw';
import DGX_WORKER_PY from '../../scripts/dgx_worker.py?raw';
import DEPLOY_SH from '../../scripts/deploy.sh?raw';
import CHECK_DGX_CODEBASE_SH from '../../scripts/check_dgx_codebase.sh?raw';

export {
  DGX_SETUP_SH,
  OCR_SPARK_ENGINE_PY,
  DGX_WORKER_PY,
  DEPLOY_SH,
  CHECK_DGX_CODEBASE_SH,
};
