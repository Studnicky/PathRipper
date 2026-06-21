/**
 * Unit tests for AonprdReconciler.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AonprdReconciler } from '../../../../plugins/aonprd/AonprdReconciler.js';
import type { CapturedConceptType } from '../../../../src/resilience/Reconciler.js';

class AonprdReconcilerTest {
  static run(): void {
    describe('AonprdReconciler', () => {
      const reconciler = new AonprdReconciler();

      it('resolves capturedElsewhere when link text matches a captured concept name', () => {
        // "Catfolk" concept at Ancestries URL.
        // Another concept whose links array contains a link to Classes/77 with text "catfolk".
        const catfolkUrl = 'https://2e.aonprd.com/Ancestries.aspx?ID=77';
        const concepts: CapturedConceptType[] = [
          {
            url:    catfolkUrl,
            output: { name: 'Catfolk', links: [] },
          },
          {
            url:    'https://2e.aonprd.com/Classes.aspx?ID=1',
            output: {
              name:  'SomeClass',
              links: [
                { href: 'Classes.aspx?ID=77', text: 'catfolk', kind: 'Classes', id: 77 },
              ],
            },
          },
        ];
        const index  = reconciler.prepare(concepts);
        const result = reconciler.resolveFailure(
          { url: 'https://2e.aonprd.com/Classes.aspx?ID=77', errors: [] },
          index,
        );
        assert.deepEqual(result, { status: 'capturedElsewhere', at: catfolkUrl });
      });

      it('resolves missing when link text matches no concept name', () => {
        // "cythbikian" (the link text) ≠ "cythbikian staff" (the concept name, normalized)
        const concepts: CapturedConceptType[] = [
          {
            url:    'https://2e.aonprd.com/Equipment.aspx?ID=3611',
            output: {
              name:  'Cythbikian Staff',
              links: [
                { href: 'Monsters.aspx?ID=3542', text: 'cythbikian', kind: 'Monsters', id: 3542 },
              ],
            },
          },
        ];
        const index  = reconciler.prepare(concepts);
        const result = reconciler.resolveFailure(
          { url: 'https://2e.aonprd.com/Monsters.aspx?ID=3542', errors: [] },
          index,
        );
        assert.deepEqual(result, { status: 'missing' });
      });

      it('handles full-url links in output.links (strips origin)', () => {
        const ancestryUrl = 'https://2e.aonprd.com/Ancestries.aspx?ID=9';
        const concepts: CapturedConceptType[] = [
          { url: ancestryUrl, output: { name: 'Catfolk', links: [] } },
          {
            url:    'https://2e.aonprd.com/Classes.aspx?ID=1',
            output: {
              name:  'SomeClass',
              // Link href is a full URL this time.
              links: [
                { href: 'https://2e.aonprd.com/Ancestries.aspx?ID=9', text: 'Catfolk', kind: 'Ancestries', id: 9 },
              ],
            },
          },
        ];
        const index  = reconciler.prepare(concepts);
        const result = reconciler.resolveFailure(
          { url: 'https://2e.aonprd.com/Ancestries.aspx?ID=9', errors: [] },
          index,
        );
        assert.deepEqual(result, { status: 'capturedElsewhere', at: ancestryUrl });
      });
    });
  }
}

AonprdReconcilerTest.run();
