class ChatApp {
    constructor() {
        this.chatHistory = document.getElementById('chat-history');
        this.abortController = null;
        // 自定义Think块的开始和结束标记
        this.thinkStartMarker = '';
        this.thinkEndMarker = '';
        this.userScrolled = false; // 标记用户是否手动滚动
        this.setupEventListeners();
    }

    setupEventListeners() {
        const form = document.getElementById('chat-form');
        form.addEventListener('submit', (e) => this.handleSubmit(e));
        
        const stopBtn = document.getElementById('stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.handleStop());
        }
        
        // 监听用户滚动事件
        this.chatHistory.addEventListener('scroll', () => {
            const threshold = 50; // 距离底部的阈值
            const atBottom = this.chatHistory.scrollHeight - this.chatHistory.scrollTop <= this.chatHistory.clientHeight + threshold;
            this.userScrolled = !atBottom;
        });
    }

    handleStop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    autoScroll() {
        // 只有当用户没有手动滚动时才自动滚动
        if (!this.userScrolled) {
            this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        const input = document.getElementById('user-input');
        const message = input.value.trim();
        
        if (!message) return;

        // 添加用户消息到聊天记录
        this.addUserMessage(message);
        input.value = '';

        // 重置滚动状态
        this.userScrolled = false;

        // 创建AI回复消息容器（初始为空）
        const botMessageDiv = this.addBotMessage('');

        // 创建AbortController用于停止请求
        this.abortController = new AbortController();

        try {
            // 发送请求到服务器
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: message }]
                }),
                signal: this.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 处理流式响应
            this.handleStreamResponse(response, botMessageDiv);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('Request aborted');
                botMessageDiv.innerHTML = `<div class="message-header"><strong>Assistant:</strong></div><div class="message-content">请求已停止</div>`;
            } else {
                console.error('Error:', error);
                botMessageDiv.innerHTML = `<div class="message-header"><strong>Assistant:</strong></div><div class="error">Sorry, something went wrong.</div>`;
            }
        }
    }

    addUserMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user-message';
        messageDiv.innerHTML = `<div class="message-header"><strong>User:</strong></div><div class="message-content">${content}</div>`;
        this.chatHistory.appendChild(messageDiv);
        this.autoScroll();
    }

    addBotMessage(content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot-message';
        messageDiv.innerHTML = `
            <div class="message-header">
                <strong>Assistant</strong>
                <button class="toggle-btn" onclick="this.closest('.message').querySelector('.think-block').classList.toggle('collapsed')">Thinking~🤔</button>
            </div>
            <div class="message-content collapsed"></div>
        `;
        this.chatHistory.appendChild(messageDiv);
        this.autoScroll();
        return messageDiv;
    }

    handleStreamResponse(response, botMessageDiv) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantMessage = '';
        let thinkContent = '';
        let inThinkBlock = false;
        let accumulatedContent = '';
        let thinkBlockCompleted = false;
        let thinkBlockElement = null;

        reader.read().then(function processText({ done, value }) {
            if (done) {
                // 展开最终内容
                const contentElement = botMessageDiv.querySelector('.message-content');
                if (contentElement) {
                    contentElement.classList.remove('collapsed');
                }
                return;
            }

            buffer += decoder.decode(value, { stream: true });
            
            // 按行处理数据
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留不完整的行
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    
                    if (data === '[DONE]') {
                        // 展开最终内容
                        const contentElement = botMessageDiv.querySelector('.message-content');
                        if (contentElement) {
                            contentElement.classList.remove('collapsed');
                        }
                        return;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices[0]?.delta?.content || '';
                        
                        if (content) {
                            // 如果没有thinkStartMarker，直接作为普通文本处理
                            if (!this.thinkStartMarker) {
                                accumulatedContent += content;
                                this.updateContent(botMessageDiv, accumulatedContent, thinkBlockCompleted, thinkBlockElement);
                                this.autoScroll();
                                continue;
                            }
                            
                            // 检查Think块开始标记
                            if (this.thinkStartMarker && content.includes(this.thinkStartMarker) && !inThinkBlock) {
                                inThinkBlock = true;
                                const parts = content.split(this.thinkStartMarker);
                                accumulatedContent += parts[0];
                                
                                if (parts.length > 1) {
                                    thinkContent = parts[1];
                                }
                                continue;
                            }
                            
                            // 检查Think块结束标记
                            if (this.thinkEndMarker && inThinkBlock && content.includes(this.thinkEndMarker)) {
                                inThinkBlock = false;
                                const parts = content.split(this.thinkEndMarker);
                                thinkContent += parts[0];
                                
                                // 显示Think内容
                                thinkBlockElement = this.displayThinkContent(botMessageDiv, thinkContent, thinkBlockElement);
                                thinkBlockCompleted = true;
                                
                                if (parts.length > 1) {
                                    accumulatedContent += parts[1];
                                }
                                thinkContent = '';
                                continue;
                            }
                            
                            // 处理Think块内的内容
                            if (inThinkBlock) {
                                thinkContent += content;
                                // 实时更新Think内容
                                thinkBlockElement = this.updateThinkContent(botMessageDiv, thinkContent, thinkBlockElement);
                                this.autoScroll();
                                continue;
                            }
                            
                            // 处理普通内容
                            accumulatedContent += content;
                            
                            // 实时更新AI回复内容并渲染Markdown
                            this.updateContent(botMessageDiv, accumulatedContent, thinkBlockCompleted, thinkBlockElement);
                            this.autoScroll();
                        }
                    } catch (e) {
                        console.error('Error parsing JSON:', e);
                    }
                }
            }
            
            // 继续读取
            reader.read().then(processText.bind(this));
        }.bind(this)).catch(error => {
            if (error.name !== 'AbortError') {
                console.error('Stream reading error:', error);
                const contentElement = botMessageDiv.querySelector('.message-content');
                if (contentElement) {
                    contentElement.innerHTML = '<div class="error">Error receiving response.</div>';
                    contentElement.classList.remove('collapsed');
                }
            }
        });
    }
    displayThinkContent(botMessageDiv, thinkContent, thinkBlockElement) {
        const contentElement = botMessageDiv.querySelector('.message-content');
        if (contentElement) {
            let thinkContainer = thinkBlockElement;
            if (!thinkContainer) {
                // 创建Think块容器
                thinkContainer = document.createElement('div');
                thinkContainer.className = 'think-block';
                contentElement.appendChild(thinkContainer);
            }
            
            // 更新Think块内容
            thinkContainer.innerHTML = DOMPurify.sanitize(marked.parse(thinkContent));
            contentElement.classList.remove('collapsed');
            this.autoScroll();
            return thinkContainer;
        }
        return null;
    }

    updateThinkContent(botMessageDiv, thinkContent, thinkBlockElement) {
        const contentElement = botMessageDiv.querySelector('.message-content');
        if (contentElement) {
            let thinkContainer = thinkBlockElement;
            if (!thinkContainer) {
                // 查找或创建Think块容器
                thinkContainer = contentElement.querySelector('.think-block');
                if (!thinkContainer) {
                    thinkContainer = document.createElement('div');
                    thinkContainer.className = 'think-block';
                    contentElement.appendChild(thinkContainer);
                }
            }
            
            // 更新Think块内容并渲染Markdown
            thinkContainer.innerHTML = DOMPurify.sanitize(marked.parse(thinkContent));
            contentElement.classList.remove('collapsed');
            this.autoScroll();
            return thinkContainer;
        }
        return null;
    }

    updateContent(botMessageDiv, content, thinkBlockCompleted, thinkBlockElement) {
        const contentElement = botMessageDiv.querySelector('.message-content');
        if (contentElement) {
            // 如果没有thinkStartMarker，则将所有内容视为普通文本
            if (!this.thinkStartMarker) {
                // 直接更新内容并渲染Markdown，不使用think块
                contentElement.innerHTML = DOMPurify.sanitize(marked.parse(content));
                contentElement.classList.remove('collapsed');
                return;
            }
            
            if (thinkBlockCompleted) {
                // 如果Think块已完成，将内容显示在Think块下方
                let textContainer = contentElement.querySelector('.text-content');
                if (!textContainer) {
                    textContainer = document.createElement('div');
                    textContainer.className = 'text-content';
                    // 将文本内容插入到Think块之后
                    if (thinkBlockElement) {
                        thinkBlockElement.after(textContainer);
                    } else {
                        contentElement.appendChild(textContainer);
                    }
                }
                
                // 更新内容并渲染Markdown
                textContainer.innerHTML = DOMPurify.sanitize(marked.parse(content));
            } else {
                // 如果Think块未完成，将内容显示在Think块内或默认区域
                let thinkContainer = thinkBlockElement;
                if (!thinkContainer) {
                    thinkContainer = contentElement.querySelector('.think-block');
                    if (!thinkContainer) {
                        // 如果还没有Think块，创建一个默认的Think块
                        thinkContainer = document.createElement('div');
                        thinkContainer.className = 'think-block';
                        contentElement.appendChild(thinkContainer);
                    }
                }
                
                // 更新Think块内容并渲染Markdown
                thinkContainer.innerHTML = DOMPurify.sanitize(marked.parse(content));
            }
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});