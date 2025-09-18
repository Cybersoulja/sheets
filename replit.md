# RSS Manager

## Overview

This is a React-based RSS management application built with TypeScript and Vite. The project is designed to manage RSS feeds and integrates with Raindrop.io for bookmark management. It provides a modern, responsive web interface for users to handle RSS content with external service integration capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **React 18** with TypeScript for the main UI framework
- **Vite** as the build tool and development server for fast development and optimized builds
- **CSS Modules/Components** for styling with a clean, modern design system
- **Component-based architecture** following React best practices

### Build and Development
- **Vite configuration** set up for Replit hosting with custom server settings (port 5000, host 0.0.0.0)
- **TypeScript configuration** with strict mode enabled and modern ES features
- **Hot Module Replacement (HMR)** for rapid development cycles

### RSS Processing
- **RSS Parser** (rss-parser library) for handling RSS feed parsing and content extraction
- Client-side RSS processing without requiring a backend server

### Integration Architecture
- **Raindrop.io Integration** for bookmark management and content saving
- External API integration patterns implemented for third-party service connectivity
- User authentication and connection status management for external services

### Development Environment
- **Replit-optimized** configuration for cloud-based development
- **Module system** using ES modules throughout the codebase
- **Development scripts** for building, previewing, and development server management

## External Dependencies

### Core Framework Dependencies
- **React 18.2.0** - Main UI framework
- **React DOM 18.2.0** - DOM rendering for React
- **TypeScript 5.2.2** - Type safety and enhanced development experience

### Build Tools
- **Vite 5.0.0** - Fast build tool and development server
- **@vitejs/plugin-react 4.2.0** - React support for Vite

### RSS Processing
- **rss-parser 3.13.0** - RSS feed parsing and content extraction

### External Service Integrations
- **Raindrop.io API** - Bookmark management and content saving service (integration implemented in UI components)

### Development Tools
- **@types/react** and **@types/react-dom** - TypeScript definitions for React
- Standard TypeScript compiler and toolchain