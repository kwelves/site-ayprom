import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isVehicleWarmupAllowed,
  type VehicleWarmupConditions,
} from "@/components/home/vehicle-showcase/warmup-gate";

const allowed: VehicleWarmupConditions = {
  entered: true,
  revealed: true,
  initialVehicleReady: true,
  firstViewSettled: true,
  transitionPhase: "idle",
  sectionVisible: true,
};

describe("фоновый прогрев фотографий техники", () => {
  it("разрешён только когда сцена вошла, раскрылась, готова и видима", () => {
    expect(isVehicleWarmupAllowed(allowed)).toBe(true);
  });

  it.each([
    ["секция ещё не входила в экран", { entered: false }],
    ["сцена ещё не раскрылась", { revealed: false }],
    ["стартовая техника не загружена", { initialVehicleReady: false }],
    ["первая сцена ещё не улеглась", { firstViewSettled: false }],
    ["идёт переключение техники", { transitionPhase: "preloading" }],
    ["секция сейчас за пределами экрана", { sectionVisible: false }],
  ] as Array<[string, Partial<VehicleWarmupConditions>]>)("запрещён, когда %s", (_name, override) => {
    expect(isVehicleWarmupAllowed({ ...allowed, ...override })).toBe(false);
  });

  it("на первом экране (ничего не вошло, ничего не готово) прогрева нет", () => {
    expect(
      isVehicleWarmupAllowed({
        entered: false,
        revealed: false,
        initialVehicleReady: false,
        firstViewSettled: false,
        transitionPhase: "idle",
        sectionVisible: false,
      }),
    ).toBe(false);
  });

  it("витрина использует именно это условие, а не прежнее выражение с «или»", () => {
    const interactive = readFileSync(
      "src/components/home/vehicle-showcase/VehicleShowcaseInteractive.tsx",
      "utf8",
    );

    expect(interactive).toContain("isVehicleWarmupAllowed({");
    expect(interactive).not.toContain("(!entered || revealed)");
  });
});
