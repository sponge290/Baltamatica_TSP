import type { SolveTSPRequest } from "./types.ts";

export function validateRequest(request: SolveTSPRequest): { valid: boolean; error?: string } {
  if (!request) {
    return { valid: false, error: "请求不能为空" };
  }
  
  if (!request.algorithm) {
    return { valid: false, error: "必须指定算法类型" };
  }
  
  if (!['DP', 'A*', 'GA'].includes(request.algorithm)) {
    return { valid: false, error: "不支持的算法类型" };
  }
  
  if (!request.cities || request.cities.length === 0) {
    return { valid: false, error: "城市数据不能为空" };
  }
  
  if (request.algorithm === 'DP' && request.cities.length > 15) {
    return { valid: false, error: "动态规划仅支持15个城市以内的小规模问题" };
  }
  
  if (request.algorithm === 'A*' && request.cities.length > 30) {
    return { valid: false, error: "A*算法推荐使用30个城市以内的中等规模问题" };
  }
  
  return { valid: true };
}
