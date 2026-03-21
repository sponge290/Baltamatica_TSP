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
  
  if (request.algorithm === 'DP' && request.cities.length > 100) {
    return { valid: false, error: "动态规划仅支持100个城市以内的问题" };
  }
  
  if (request.algorithm === 'A*' && request.cities.length > 100) {
    return { valid: false, error: "A*算法仅支持100个城市以内的问题" };
  }
  
  return { valid: true };
}
