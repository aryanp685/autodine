import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SubmitButton } from './SubmitButton';

/**
 * What a submit button must say before anybody touches it.
 *
 * The pending state needs a browser, but the property that matters most is the
 * one that can regress silently: the server must never render "Saving…" or an
 * `aria-busy` button, because that is a form claiming to be mid-write when
 * nothing has been sent. It would also break every no-JavaScript reader, who
 * would see a button stuck on a state that can never change.
 */
describe('SubmitButton', () => {
  it('sends the idle label and no pending state', () => {
    const html = renderToStaticMarkup(<SubmitButton>Save details</SubmitButton>);

    expect(html).toContain('>Save details</button>');
    expect(html).not.toContain('Saving');
    expect(html).not.toContain('aria-busy');
    // The kit's class string mentions disabled: variants; the attribute is
    // what matters, and React writes it as an empty string.
    expect(html).not.toContain('disabled=""');
  });

  it('is a submit button, so it works without JavaScript', () => {
    const html = renderToStaticMarkup(<SubmitButton>Save tax rate</SubmitButton>);

    expect(html).toContain('type="submit"');
  });

  it('keeps an explicit disabled reason even while idle', () => {
    const html = renderToStaticMarkup(<SubmitButton disabled>Save UPI details</SubmitButton>);

    // A read-only role must see the control as unavailable before any press,
    // not discover it after.
    expect(html).toContain('disabled');
  });

  it('carries name and value, which a multi-action form needs to tell its buttons apart', () => {
    const html = renderToStaticMarkup(
      <SubmitButton name="active" value="false">
        Disable
      </SubmitButton>,
    );

    // Tables & QR posts several server actions from one form; the pressed
    // button's name/value is how the action knows which one was pressed.
    expect(html).toContain('name="active"');
    expect(html).toContain('value="false"');
  });
});
