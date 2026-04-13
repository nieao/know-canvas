/**
 * ErrorBoundary - 全局错误边界
 * 捕获子组件渲染错误，防止整个应用崩溃
 */

import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('知识图谱渲染错误:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="h-screen w-screen flex items-center justify-center"
          style={{ background: 'var(--white, #fafafa)' }}
        >
          <div className="text-center max-w-md px-8">
            <div
              className="text-xs tracking-widest mb-4"
              style={{ color: 'var(--warm, #c8a882)', letterSpacing: '0.35em' }}
            >
              ERROR / BOUNDARY
            </div>
            <h1
              className="text-xl font-light mb-4"
              style={{ fontFamily: '"Noto Serif SC", Georgia, serif', color: 'var(--black, #1a1a1a)' }}
            >
              渲染出错了
            </h1>
            <p className="text-sm mb-6" style={{ color: 'var(--gray-700, #555)' }}>
              {this.state.error?.message || '未知错误'}
            </p>
            <button
              onClick={this.handleReset}
              className="px-6 py-2.5 text-sm rounded-md transition-all duration-300"
              style={{
                border: '1px solid var(--warm, #c8a882)',
                color: 'var(--warm, #c8a882)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--warm, #c8a882)'
                e.currentTarget.style.color = 'white'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--warm, #c8a882)'
              }}
            >
              重试
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
