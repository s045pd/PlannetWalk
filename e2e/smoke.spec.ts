import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    __game: {
      ready: boolean;
      setTimeOfDay: (t: number) => void;
      setView: (yaw: number, pitch: number) => void;
      setWeather: (name: string, duration?: number) => void;
      teleportToCity: () => void;
      getFps: () => number;
      playerPos: () => { x: number; y: number; z: number };
      groundHeight: () => number;
    };
  }
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // 每次导航前清空存档/偏好，保证确定性出生点与画质
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready, undefined, { timeout: 60000 });
  return errors;
}

test('游戏加载无控制台错误，玩家站立在地面', async ({ page }) => {
  const errors = await boot(page);
  expect(errors).toEqual([]);
  const above = await page.evaluate(
    () => window.__game.playerPos().y - window.__game.groundHeight(),
  );
  expect(above).toBeGreaterThan(0);
  expect(above).toBeLessThan(4);
});

test('关键场景截图基线', async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__game.setTimeOfDay(0.5);
    window.__game.setView(0.785, 0.05);
  });
  await page.waitForTimeout(2000);
  await expect(page).toHaveScreenshot('noon-city-skyline.png');

  await page.evaluate(() => window.__game.setTimeOfDay(0.29));
  await page.waitForTimeout(1500);
  await expect(page).toHaveScreenshot('dawn.png');

  await page.evaluate(() => {
    window.__game.setTimeOfDay(0.98);
    window.__game.setView(0.5, 0.75);
  });
  await page.waitForTimeout(1500);
  await expect(page).toHaveScreenshot('night-ring-stars.png');

  await page.evaluate(() => {
    window.__game.setTimeOfDay(0.45);
    window.__game.setView(0.785, 0.05);
    window.__game.setWeather('DUST_STORM', 2);
  });
  await page.waitForTimeout(4000);
  await expect(page).toHaveScreenshot('dust-storm.png');

  await page.evaluate(() => {
    window.__game.setWeather('ASHFALL', 2);
    window.__game.teleportToCity();
    window.__game.setView(1.9, 0.15);
  });
  await page.waitForTimeout(4000);
  await expect(page).toHaveScreenshot('city-street-ashfall.png');
});

test('渲染循环存活 (headless 为软件渲染，仅验证循环运转)', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(4000);
  const fps = await page.evaluate(() => window.__game.getFps());
  expect(fps).toBeGreaterThan(4);
});
