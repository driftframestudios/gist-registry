import React from "react";
import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, test, vi} from "vitest";
import {App} from "../src/app.jsx";

function regionForHeading(name) {
  return screen.getByRole("heading", {name}).closest("section");
}

describe("visual-contract receiver", () => {
  test("renders native and React Aria routes with visible labels above controls", () => {
    render(<App settlementDelay={0} />);

    const nativeRegion = regionForHeading("Browser semantics carry the first route");
    const ariaRegion = regionForHeading("Headless behavior receives the same contract");
    const nativeLabel = within(nativeRegion).getByText("Specimen state", {selector: "label"});
    const nativeSelect = within(nativeRegion).getByLabelText("Specimen state");
    const ariaLabel = within(ariaRegion).getByText("Specimen state", {selector: ".react-aria-Label"});
    const ariaTrigger = ariaRegion.querySelector("button.select-trigger");

    expect(nativeSelect.tagName).toBe("SELECT");
    expect(ariaTrigger).toBeTruthy();
    expect(nativeLabel.compareDocumentPosition(nativeSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ariaLabel.compareDocumentPosition(ariaTrigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("native keyboard interaction announces acceptance and returns focus", async () => {
    const user = userEvent.setup();
    render(<App settlementDelay={0} />);
    const nativeRegion = regionForHeading("Browser semantics carry the first route");
    const select = within(nativeRegion).getByLabelText("Specimen state");
    const preview = within(nativeRegion).getByRole("button", {name: "Request native preview"});

    select.focus();
    await user.selectOptions(select, "review-routing");
    preview.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/accepted Review routing/);
    });
    expect(document.activeElement).toBe(preview);
    expect(screen.getByText("receiver:1:review-routing")).toBeTruthy();
  });

  test("release exposes one stable receipt across repeated activation", async () => {
    const user = userEvent.setup();
    render(<App settlementDelay={0} />);
    const nativeRegion = regionForHeading("Browser semantics carry the first route");
    const preview = within(nativeRegion).getByRole("button", {name: "Request native preview"});
    const release = within(nativeRegion).getByRole("button", {name: "Release accepted state"});

    await user.click(preview);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/accepted/));
    await user.click(release);

    const receipt = "release:1:participant-intake";
    expect(screen.getByText(receipt)).toBeTruthy();
    await user.click(release);
    expect(screen.getByText(receipt)).toBeTruthy();
  });

  test("a newer preview aborts pending work while the current generation settles", async () => {
    const user = userEvent.setup();
    const abort = vi.spyOn(AbortController.prototype, "abort");
    render(<App settlementDelay={30} />);
    const nativeRegion = regionForHeading("Browser semantics carry the first route");
    const select = within(nativeRegion).getByLabelText("Specimen state");
    const preview = within(nativeRegion).getByRole("button", {name: "Request native preview"});

    await user.click(preview);
    await user.selectOptions(select, "release-receipt");
    await user.click(preview);

    expect(abort).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/request 2 accepted Release receipt/));
    expect(screen.getByText("receiver:2:release-receipt")).toBeTruthy();
    abort.mockRestore();
  });

  test("unmount aborts pending preview work", async () => {
    const user = userEvent.setup();
    const abort = vi.spyOn(AbortController.prototype, "abort");
    const view = render(<App settlementDelay={1000} />);
    const nativeRegion = regionForHeading("Browser semantics carry the first route");

    await user.click(within(nativeRegion).getByRole("button", {name: "Request native preview"}));
    view.unmount();

    expect(abort).toHaveBeenCalledTimes(1);
    abort.mockRestore();
  });

  test("status and state values remain available to assistive technology", () => {
    render(<App settlementDelay={0} />);

    const status = screen.getByRole("status");
    const state = screen.getByText("Draft", {selector: "dt"}).closest("dl");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(state.getAttribute("aria-label")).toBe("Receiver state");
  });
});
