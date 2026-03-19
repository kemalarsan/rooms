import { NextResponse } from "next/server"

// Standard error response helpers for consistent API error handling

export function apiError(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status })
}

export function notFound(message: string = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function unauthorized(message: string = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbidden(message: string = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function badRequest(message: string = "Bad request") {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function conflict(message: string = "Conflict") {
  return NextResponse.json({ error: message }, { status: 409 })
}

export function rateLimited(message: string = "Rate limit exceeded", resetTime?: number, remaining?: number) {
  return NextResponse.json(
    { 
      error: message,
      ...(resetTime && { resetTime }),
      ...(remaining !== undefined && { remaining })
    }, 
    { status: 429 }
  )
}

export function internalError(message: string = "Internal server error") {
  return NextResponse.json({ error: message }, { status: 500 })
}