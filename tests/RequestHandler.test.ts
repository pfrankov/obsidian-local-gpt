import { RequestHandler } from '../src/request-handler';

jest.mock('electron', () => ({
  remote: {
    net: {
      request: jest.fn(),
    },
  },
}));

jest.mock('obsidian', () => ({
  Platform: {
    isMobileApp: false
  }
}));

describe('RequestHandler', () => {
  let requestHandler: RequestHandler;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe('Desktop (isMobileApp: false)', () => {
    beforeEach(() => {
      jest.doMock('obsidian', () => ({
        Platform: {
          isMobileApp: false
        }
      }));
      const RequestHandlerModule = require('../src/request-handler');
      requestHandler = RequestHandlerModule.RequestHandler.getInstance();
    });

    test('makeRequest success using remote.net.request', async () => {
      const mockRequest = {
        on: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      };
      const mockResponse = {
        on: jest.fn(),
      };
      (jest.requireMock('electron').remote.net.request as jest.Mock).mockReturnValue(mockRequest);

      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'response') {
          callback(mockResponse);
        }
      });

      mockResponse.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('test'));
        }
        if (event === 'end') {
          callback();
        }
      });

      const options = {
        method: 'GET',
        url: 'http://test.com',
        abortController: new AbortController(),
      };

      const handlers = {
        onData: jest.fn(),
        onError: jest.fn(),
        onEnd: jest.fn(),
      };

      await requestHandler.makeRequest(options, handlers);

      expect(jest.requireMock('electron').remote.net.request).toHaveBeenCalledWith(expect.objectContaining({
        method: 'GET',
        url: 'http://test.com',
      }));
      expect(handlers.onData).toHaveBeenCalledWith('test');
      expect(handlers.onEnd).toHaveBeenCalled();
      expect(handlers.onError).not.toHaveBeenCalled();
    });
  });

  describe('Mobile (isMobileApp: true)', () => {
    beforeEach(() => {
      jest.doMock('obsidian', () => ({
        Platform: {
          isMobileApp: true
        }
      }));
      const RequestHandlerModule = require('../src/request-handler');
      requestHandler = RequestHandlerModule.RequestHandler.getInstance();
    });

    test('makeRequest success using fetch', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        body: {
          getReader: () => ({
            read: jest.fn()
              .mockResolvedValueOnce({ value: new TextEncoder().encode('test'), done: false })
              .mockResolvedValueOnce({ done: true })
          })
        }
      });
      global.fetch = mockFetch;

      const options = {
        method: 'GET',
        url: 'http://test.com',
        abortController: new AbortController(),
      };

      const handlers = {
        onData: jest.fn(),
        onError: jest.fn(),
        onEnd: jest.fn(),
      };

      await requestHandler.makeRequest(options, handlers);

      expect(mockFetch).toHaveBeenCalledWith('http://test.com', expect.any(Object));
      expect(handlers.onData).toHaveBeenCalledWith('test');
      expect(handlers.onEnd).toHaveBeenCalled();
      expect(handlers.onError).not.toHaveBeenCalled();
    });
  });
});