/**
 * @copyright (c) 2025 LaserForge. All rights reserved.
 */
import { strict as assert } from 'node:assert';
import { createEmptyJob } from '../src/core/job/Job';
import { createEmptyPlan } from '../src/core/plan/Plan';
import { GrblOutputStrategy } from '../src/core/output/GrblStrategy';
import { TemplateValidationError } from '../src/core/output/Output';
import { emptyTemplateContext } from '../src/core/plan/GcodeTemplates';

const strategy = new GrblOutputStrategy();
const job = createEmptyJob('TemplateValidation', 'test-project');
const plan = createEmptyPlan(job.id);
const context = {
  ...emptyTemplateContext(),
  jobName: job.name,
  bedWidthMm: 100,
  bedHeightMm: 100,
  maxSpeedMmPerMin: 1200,
};

assert.throws(
  () => strategy.generate(plan, job, {
    gcodeHeaderTemplate: '$RST=*',
    gcodeTemplateContext: context,
    maxSpindle: 1000,
  }),
  TemplateValidationError,
);

assert.throws(
  () => strategy.generate(plan, job, {
    gcodeFooterTemplate: '; custom footer without laser off',
    gcodeTemplateContext: context,
    maxSpindle: 1000,
  }),
  TemplateValidationError,
);

const output = strategy.generate(plan, job, {
  gcodeHeaderTemplate: '; safe header',
  gcodeFooterTemplate: 'M5\n; safe footer',
  gcodeTemplateContext: context,
  maxSpindle: 1000,
  clock: () => '2026-05-06T00:00:00.000Z',
});

assert.equal(output.format, 'grbl');
assert.ok(output.text?.includes('; safe header'));
assert.ok(output.text?.includes('; safe footer'));

